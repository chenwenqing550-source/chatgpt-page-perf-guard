(() => {
  "use strict";

  const Core = globalThis.CGPTPerfCore;
  if (!Core) return;

  const WebExt = globalThis.browser || globalThis.chrome;
  if (!WebExt || !WebExt.runtime) return;

  const WINDOW_MS = 10000;
  const UPDATE_MS = 2000;
  const DRIFT_INTERVAL_MS = 1000;
  const FRAME_BURST_MS = 400;
  const FRAME_BURST_EVERY_MS = 5000;
  const COVERAGE_EVERY_MS = 8000;
  const MAX_COVERAGE_SAMPLES = 120;

  const PerformanceObserverApi = globalThis.PerformanceObserver;
  const supportedEntryTypes = new Set(
    ((PerformanceObserverApi && PerformanceObserverApi.supportedEntryTypes) || []).map(String)
  );

  const supportsLoAF = supportedEntryTypes.has("long-animation-frame");
  const supportsLongTask = supportedEntryTypes.has("longtask");
  const supportsEventTiming = supportedEntryTypes.has("event");

  let optimizationEnabled = true;
  let firstSampleAt = performance.now();
  let lastTimerExpected = performance.now() + DRIFT_INTERVAL_MS;
  let lastCoverageAt = 0;
  let coverageEstimate = 0;
  let loadedBlocks = 0;
  let structureMode = "unknown";
  let recommendationState = "sampling";
  let historyCalibration = null;
  let totalUpdateTicks = 0;
  let foregroundUpdateTicks = 0;

  const blockingSamples = [];
  const frameSamples = [];
  const driftSamples = [];
  const interactionSamples = new Map();
  const historySamples = [];

  let latest = {
    pagePressure: null,
    windowPressure: 0,
    recommendationState: "sampling",
    coverage: 0,
    optimizationEnabled: true,
    status: "starting",
    blockingRatio: null,
    blockingSource: "unknown",
    jankRatio: null,
    driftMs: null,
    eventLatencyMs: null,
    interactionCount: 0,
    loadedBlocks: 0,
    structureMode: "unknown",
    transientBusy: false,
    historyAgeMs: 0,
    supportedSignals: 0,
    expectedSignals: 4,
    foregroundRatio: 0,
    sampledAt: firstSampleAt,
    historyCalibration: null
  };

  function pruneArray(samples, now, maxAge = WINDOW_MS) {
    while (samples.length && now - samples[0].time > maxAge) {
      samples.shift();
    }
  }

  function pruneInteractions(now) {
    for (const [id, sample] of interactionSamples.entries()) {
      if (now - sample.time > WINDOW_MS) {
        interactionSamples.delete(id);
      }
    }
  }

  function currentTargets() {
    const root = document.documentElement;
    const primary = document.querySelectorAll(
      'article[data-testid^="conversation-turn-"]'
    );

    if (primary.length) {
      structureMode = "primary";
      if (root) root.removeAttribute("data-cgpt-perf-fallback");
      return primary;
    }

    const fallback = document.querySelectorAll("[data-message-author-role]");

    if (fallback.length) {
      structureMode = "fallback";
      if (root) root.setAttribute("data-cgpt-perf-fallback", "on");
      return fallback;
    }

    structureMode = "unknown";
    if (root) root.removeAttribute("data-cgpt-perf-fallback");
    return fallback;
  }

  function applyOptimizationState() {
    const root = document.documentElement;
    if (!root) return;

    if (optimizationEnabled) {
      root.setAttribute("data-cgpt-perf-opt", "on");
    } else {
      root.removeAttribute("data-cgpt-perf-opt");
    }

    latest.optimizationEnabled = optimizationEnabled;
  }

  function observeBlocking() {
    if (!PerformanceObserverApi) return;

    const type = supportsLoAF
      ? "long-animation-frame"
      : supportsLongTask
        ? "longtask"
        : null;

    if (!type) return;

    try {
      const observer = new PerformanceObserverApi((list) => {
        const now = performance.now();

        for (const entry of list.getEntries()) {
          const eventTime = entry.startTime + entry.duration;
          blockingSamples.push({
            time: eventTime,
            duration: Number(entry.duration) || 0
          });
        }

        pruneArray(blockingSamples, now);
      });

      observer.observe({ type, buffered: true });
    } catch (_) {
      // 不支持时保持 UNKNOWN，不把“没有数据”当成 0。
    }
  }

  function observeInteractions() {
    if (!PerformanceObserverApi || !supportsEventTiming) return;

    try {
      const observer = new PerformanceObserverApi((list) => {
        const now = performance.now();

        for (const entry of list.getEntries()) {
          const interactionId = Number(entry.interactionId) || 0;
          if (!interactionId) continue;

          const duration = Number(entry.duration) || 0;
          if (duration <= 0) continue;

          const eventTime = entry.startTime + entry.duration;
          const existing = interactionSamples.get(interactionId);

          if (!existing || duration > existing.duration) {
            interactionSamples.set(interactionId, {
              time: eventTime,
              duration
            });
          }
        }

        pruneInteractions(now);
      });

      observer.observe({
        type: "event",
        buffered: true,
        durationThreshold: 40
      });
    } catch (_) {
      // 不支持时保持 UNKNOWN。
    }
  }

  function sampleDrift() {
    const now = performance.now();
    const drift = Math.max(0, now - lastTimerExpected);

    lastTimerExpected = now + DRIFT_INTERVAL_MS;
    driftSamples.push({
      time: now,
      drift
    });

    pruneArray(driftSamples, now);
  }

  function runFrameBurst() {
    if (document.hidden) return;

    const started = performance.now();
    let previous = started;

    function step(now) {
      const delta = now - previous;
      previous = now;

      if (delta > 0 && delta < 1000) {
        frameSamples.push({
          time: now,
          jank: delta > 33.4 ? 1 : 0
        });
      }

      if (now - started < FRAME_BURST_MS) {
        requestAnimationFrame(step);
      }
    }

    requestAnimationFrame(step);
  }

  function estimateCoverage(now) {
    if (now - lastCoverageAt < COVERAGE_EVERY_MS) {
      return coverageEstimate;
    }

    lastCoverageAt = now;

    const nodes = currentTargets();
    loadedBlocks = nodes.length;

    if (!loadedBlocks) {
      coverageEstimate = 0;
      return coverageEstimate;
    }

    const viewportHeight =
      window.innerHeight || document.documentElement.clientHeight || 0;

    const sampleCount = Math.min(loadedBlocks, MAX_COVERAGE_SAMPLES);
    const step = loadedBlocks / sampleCount;
    let offscreen = 0;

    for (let i = 0; i < sampleCount; i += 1) {
      const index = Math.min(loadedBlocks - 1, Math.floor(i * step));
      const rect = nodes[index].getBoundingClientRect();

      if (rect.bottom < -200 || rect.top > viewportHeight + 200) {
        offscreen += 1;
      }
    }

    coverageEstimate = Math.round((offscreen / sampleCount) * 100);
    return coverageEstimate;
  }

  function collectSignals(now) {
    pruneArray(blockingSamples, now);
    pruneArray(frameSamples, now);
    pruneArray(driftSamples, now);
    pruneInteractions(now);

    let blockingRatio = null;
    let blockingSource = "unknown";

    if (supportsLoAF || supportsLongTask) {
      const blockingMs = blockingSamples.reduce(
        (sum, item) => sum + item.duration,
        0
      );
      blockingRatio = Core.clamp(blockingMs / WINDOW_MS, 0, 1);
      blockingSource = supportsLoAF ? "loaf" : "longtask";
    }

    let jankRatio = null;
    if (frameSamples.length) {
      const jankCount = frameSamples.reduce(
        (sum, item) => sum + item.jank,
        0
      );
      jankRatio = jankCount / frameSamples.length;
    }

    let driftMs = null;
    if (driftSamples.length) {
      driftMs = Core.average(
        driftSamples.map((item) => item.drift)
      );
    }

    let eventLatencyMs = null;
    const interactionDurations = Array.from(
      interactionSamples.values(),
      (item) => item.duration
    );

    if (interactionDurations.length) {
      // 这是“交互响应样本”，不是官方 INP。
      eventLatencyMs = Core.percentile(interactionDurations, 0.98);
    }

    return {
      blockingRatio,
      blockingSource,
      jankRatio,
      driftMs,
      eventLatencyMs,
      interactionCount: interactionDurations.length
    };
  }

  function updateMetrics() {
    const now = performance.now();
    totalUpdateTicks += 1;

    if (document.hidden) {
      latest.status = "background";
      latest.sampledAt = now;
      latest.foregroundRatio = totalUpdateTicks
        ? foregroundUpdateTicks / totalUpdateTicks
        : 0;
      return;
    }

    foregroundUpdateTicks += 1;

    const coverage = optimizationEnabled
      ? estimateCoverage(now)
      : 0;

    if (!optimizationEnabled && now - lastCoverageAt >= COVERAGE_EVERY_MS) {
      estimateCoverage(now);
    }

    const signals = collectSignals(now);

    const pagePressure = Core.calculatePagePressure({
      blockingRatio: signals.blockingRatio,
      jankRatio: signals.jankRatio,
      driftMs: signals.driftMs,
      eventLatencyMs: signals.eventLatencyMs
    });

    if (pagePressure != null) {
      historySamples.push({
        time: now,
        pressure: pagePressure
      });
      pruneArray(historySamples, now, Core.CONFIG.HISTORY_MS);
    }

    const windowState = Core.calculateWindowPressure({
      historySamples,
      now,
      currentPressure: pagePressure == null ? 0 : pagePressure,
      loadedBlocks
    });

    const historyAgeMs = Math.max(
      windowState.historyAgeMs,
      now - firstSampleAt
    );

    recommendationState = Core.nextRecommendationState({
      previousState: recommendationState,
      windowPressure: windowState.windowPressure,
      historySamples,
      now,
      transientBusy: windowState.transientBusy,
      historyAgeMs
    });

    const foregroundRatio = totalUpdateTicks
      ? foregroundUpdateTicks / totalUpdateTicks
      : 0;

    const supportedSignals =
      Number(supportsLoAF || supportsLongTask) +
      1 + // requestAnimationFrame sampling
      1 + // timer drift
      Number(supportsEventTiming);

    latest = {
      pagePressure,
      windowPressure: windowState.windowPressure,
      recommendationState,
      coverage,
      optimizationEnabled,
      status:
        historyAgeMs < Core.CONFIG.MIN_GUIDANCE_MS
          ? "sampling"
          : "running",
      blockingRatio:
        signals.blockingRatio == null
          ? null
          : Math.round(signals.blockingRatio * 1000) / 10,
      blockingSource: signals.blockingSource,
      jankRatio:
        signals.jankRatio == null
          ? null
          : Math.round(signals.jankRatio * 1000) / 10,
      driftMs:
        signals.driftMs == null
          ? null
          : Math.round(signals.driftMs * 10) / 10,
      eventLatencyMs:
        signals.eventLatencyMs == null
          ? null
          : Math.round(signals.eventLatencyMs),
      interactionCount: signals.interactionCount,
      loadedBlocks,
      structureMode,
      transientBusy: windowState.transientBusy,
      historyAgeMs: Math.round(historyAgeMs),
      supportedSignals,
      expectedSignals: 4,
      foregroundRatio,
      sampledAt: now
    };
  }

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  }

  function calibrationForCurrentWindow() {
    if (!historyCalibration) return null;

    const currentId = currentConversationId();
    return {
      ...historyCalibration,
      matchesCurrentConversation:
        Boolean(currentId) &&
        Boolean(historyCalibration.conversationId) &&
        currentId === historyCalibration.conversationId
    };
  }

  WebExt.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "getMetrics") {
      sendResponse({
        ok: true,
        metrics: {
          ...latest,
          historyCalibration: calibrationForCurrentWindow(),
          currentConversationId: currentConversationId()
        }
      });
      return true;
    }

    if (message.type === "setHistoryCalibration") {
      const summary = message.summary;

      if (!summary || summary.valid !== true) {
        sendResponse({
          ok: false,
          error: "历史快照无效"
        });
        return true;
      }

      historyCalibration = {
        valid: true,
        sourceKind: summary.sourceKind || "unknown",
        format: summary.format,
        schemaVersion: summary.schemaVersion || null,
        exportedAt: summary.exportedAt || null,
        coverage: summary.coverage || null,
        conversationId: summary.conversationId || null,
        messageCount: Number(summary.messageCount) || 0,
        assetCount: Core.normalizeOptionalCount(summary.assetCount),
        userMessages: Number(summary.userMessages) || 0,
        assistantMessages: Number(summary.assistantMessages) || 0,
        toolMessages: Number(summary.toolMessages) || 0,
        systemMessages: Number(summary.systemMessages) || 0,
        activeBranchCounted: Boolean(summary.activeBranchCounted),
        byteSize: Number(summary.byteSize) || 0,
        depthLevel: summary.depthLevel || "low"
      };

      sendResponse({
        ok: true,
        calibration: calibrationForCurrentWindow()
      });
      return true;
    }

    if (message.type === "toggleOptimization") {
      optimizationEnabled = Boolean(message.enabled);
      applyOptimizationState();

      latest = {
        ...latest,
        optimizationEnabled
      };

      sendResponse({
        ok: true,
        metrics: latest
      });
      return true;
    }
  });

  observeBlocking();
  observeInteractions();
  applyOptimizationState();

  setInterval(() => {
    if (!document.hidden) {
      sampleDrift();
    }
  }, DRIFT_INTERVAL_MS);

  setInterval(runFrameBurst, FRAME_BURST_EVERY_MS);
  setInterval(updateMetrics, UPDATE_MS);

  document.addEventListener(
    "visibilitychange",
    () => {
      lastTimerExpected = performance.now() + DRIFT_INTERVAL_MS;

      if (!document.hidden) {
        applyOptimizationState();
        runFrameBurst();
      }
    },
    { passive: true }
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        applyOptimizationState();
        runFrameBurst();
        updateMetrics();
      },
      { once: true }
    );
  } else {
    applyOptimizationState();
    runFrameBurst();
    updateMetrics();
  }
})();
