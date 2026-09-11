(() => {
  "use strict";

  const Core = globalThis.CGPTPerfCore;
  const Runtime = globalThis.CGPTPerfRuntime;
  if (!Core || !Runtime) return;

  const WebExt = globalThis.browser || globalThis.chrome;
  if (!WebExt || !WebExt.runtime) return;

  const WINDOW_MS = 10000;
  const UPDATE_MS = 2000;
  const DRIFT_INTERVAL_MS = 1000;
  const FRAME_BURST_MS = 250;
  const ACTIVE_PROBE_EVERY_MS = 15000;
  const COLD_MAINTENANCE_EVERY_MS = 10000;
  const COLD_STABLE_MS = 5000;
  const MUTATION_WINDOW_MS = 1000;
  const SCROLL_ACTIVE_MS = 700;
  const DIAGNOSTIC_ITEMS = 60;

  const PerformanceObserverApi = globalThis.PerformanceObserver;
  const supportedEntryTypes = new Set(
    ((PerformanceObserverApi && PerformanceObserverApi.supportedEntryTypes) || []).map(String)
  );

  const supportsLoAF = supportedEntryTypes.has("long-animation-frame");
  const supportsLongTask = supportedEntryTypes.has("longtask");
  const supportsEventTiming = supportedEntryTypes.has("event");
  const passiveSignalsAvailable = supportsLoAF || supportsLongTask;

  let optimizationEnabled = true;
  let firstSampleAt = performance.now();
  let lastTimerExpected = performance.now() + DRIFT_INTERVAL_MS;
  let lastColdMaintenanceAt = 0;
  let coverageEstimate = null;
  let loadedBlocks = 0;
  let structureMode = "unknown";
  let recommendationState = "sampling";
  let historyCalibration = null;
  let totalUpdateTicks = 0;
  let foregroundUpdateTicks = 0;
  let lastScrollAt = -Infinity;
  let lastInteractionAt = -Infinity;
  let lastMutationAt = -Infinity;
  let lastBlockingAt = -Infinity;
  let selfWorkMs = 0;
  let activityState = "quiet";
  let activeProbeSuppressed = true;
  let turnObserver = null;

  const blockingSamples = [];
  const frameSamples = [];
  const driftSamples = [];
  const mutationSamples = [];
  const interactionSamples = new Map();
  const historySamples = [];
  const incidents = Runtime.createRingBuffer(DIAGNOSTIC_ITEMS);
  const trackedTurns = new Set();
  const turnNearState = new WeakMap();
  const turnMutationAt = new WeakMap();

  let latest = {
    pagePressure: null,
    windowPressure: 0,
    recommendationState: "sampling",
    coverage: null,
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
    historyCalibration: null,
    activityState: "quiet",
    activeProbeSuppressed: true,
    selfWorkMs: 0,
    recentIncidents: []
  };

  function pruneArray(samples, now, maxAge = WINDOW_MS) {
    while (samples.length && now - samples[0].time > maxAge) samples.shift();
  }

  function pruneInteractions(now) {
    for (const [id, sample] of interactionSamples.entries()) {
      if (now - sample.time > WINDOW_MS) interactionSamples.delete(id);
    }
  }

  function pruneMutations(now) {
    pruneArray(mutationSamples, now, MUTATION_WINDOW_MS);
  }

  function mutationRate(now) {
    pruneMutations(now);
    return mutationSamples.reduce((sum, item) => sum + item.count, 0);
  }

  function recentBlockingMs(now, maxAge = 1000) {
    return blockingSamples.reduce(
      (sum, item) => now - item.time <= maxAge ? sum + item.duration : sum,
      0
    );
  }

  function activitySnapshot(now) {
    const scrollActive = now - lastScrollAt < SCROLL_ACTIVE_MS;
    const stableAnchor = Math.max(lastScrollAt, lastInteractionAt, lastMutationAt, lastBlockingAt);
    const stableForMs = Number.isFinite(stableAnchor) ? Math.max(0, now - stableAnchor) : Infinity;
    const interactionAgeMs = Number.isFinite(lastInteractionAt)
      ? Math.max(0, now - lastInteractionAt)
      : Infinity;

    const state = Runtime.classifyActivityState({
      hidden: document.hidden,
      scrollActive,
      mutationRate: mutationRate(now),
      recentBlockingMs: recentBlockingMs(now),
      stableForMs,
      interactionAgeMs
    });

    return { state, stableForMs, interactionAgeMs };
  }

  function currentTargets() {
    const root = document.documentElement;
    const primary = document.querySelectorAll('article[data-testid^="conversation-turn-"]');

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

  function clearColdState() {
    for (const node of trackedTurns) {
      if (node && node.removeAttribute) node.removeAttribute("data-cgpt-perf-cold");
    }
  }

  function applyOptimizationState() {
    const root = document.documentElement;
    if (!root) return;
    if (optimizationEnabled) root.setAttribute("data-cgpt-perf-opt", "on");
    else {
      root.removeAttribute("data-cgpt-perf-opt");
      clearColdState();
    }
    latest.optimizationEnabled = optimizationEnabled;
  }

  function ensureTurnObserver() {
    if (turnObserver || typeof IntersectionObserver !== "function") return turnObserver;

    try {
      turnObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const node = entry.target;
          const isNear = Boolean(entry.isIntersecting);
          turnNearState.set(node, isNear);
          if (isNear && node && node.removeAttribute) {
            node.removeAttribute("data-cgpt-perf-cold");
          }
        }
      }, {
        root: null,
        rootMargin: "1800px 0px 1800px 0px",
        threshold: 0
      });
    } catch (_) {
      turnObserver = null;
    }

    return turnObserver;
  }

  function closestTurn(target) {
    let node = target || null;
    if (node && node.nodeType !== 1) node = node.parentElement || null;
    if (!node || typeof node.closest !== "function") return null;

    const primaryTurn = node.closest('article[data-testid^="conversation-turn-"]');
    if (primaryTurn) return primaryTurn;
    return node.closest("[data-message-author-role]");
  }

  function observeBlocking() {
    if (!PerformanceObserverApi) return;
    const type = supportsLoAF ? "long-animation-frame" : supportsLongTask ? "longtask" : null;
    if (!type) return;

    try {
      const observer = new PerformanceObserverApi((list) => {
        const now = performance.now();
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration) || 0;
          const eventTime = entry.startTime + duration;
          blockingSamples.push({ time: eventTime, duration });
          lastBlockingAt = Math.max(lastBlockingAt, eventTime);
          if (duration >= 50) incidents.push({
            time: Math.round(eventTime),
            kind: type,
            duration: Math.round(duration),
            optimizationEnabled
          });
        }
        pruneArray(blockingSamples, now);
      });
      observer.observe({ type, buffered: true });
    } catch (_) {
      // Unsupported browsers stay UNKNOWN.
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
          const eventTime = entry.startTime + duration;
          const existing = interactionSamples.get(interactionId);
          if (!existing || duration > existing.duration) {
            interactionSamples.set(interactionId, { time: eventTime, duration });
          }
        }
        pruneInteractions(now);
      });
      observer.observe({ type: "event", buffered: true, durationThreshold: 40 });
    } catch (_) {
      // Unsupported browsers stay UNKNOWN.
    }
  }

  function observeMutations() {
    if (typeof MutationObserver !== "function" || !document.documentElement) return;
    try {
      const observer = new MutationObserver((records) => {
        const now = performance.now();
        const count = Math.max(1, records.length);
        mutationSamples.push({ time: now, count });
        lastMutationAt = now;

        const inspectCount = Math.min(records.length, 12);
        for (let i = 0; i < inspectCount; i += 1) {
          const turn = closestTurn(records[i].target);
          if (turn) {
            turnMutationAt.set(turn, now);
            if (turn.removeAttribute) turn.removeAttribute("data-cgpt-perf-cold");
          }
        }

        pruneMutations(now);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    } catch (_) {
      // DOM activity becomes UNKNOWN rather than failing the monitor.
    }
  }

  function markInteraction() {
    lastInteractionAt = performance.now();
  }

  function markScroll() {
    lastScrollAt = performance.now();
  }

  function installActivityListeners() {
    const passive = { passive: true, capture: true };
    for (const type of ["pointerdown", "keydown", "input", "submit", "click"]) {
      document.addEventListener(type, markInteraction, passive);
    }
    for (const type of ["wheel", "touchmove", "scroll"]) {
      document.addEventListener(type, markScroll, passive);
    }
  }

  function sampleDrift() {
    const now = performance.now();
    const drift = Math.max(0, now - lastTimerExpected);
    lastTimerExpected = now + DRIFT_INTERVAL_MS;
    if (document.hidden) return;
    driftSamples.push({ time: now, drift });
    pruneArray(driftSamples, now);
  }

  function runFrameBurst() {
    if (document.hidden) return;
    const snapshot = activitySnapshot(performance.now());
    if (!Runtime.shouldRunActiveProbe(snapshot.state, passiveSignalsAvailable)) return;

    const started = performance.now();
    let previous = started;
    function step(now) {
      const delta = now - previous;
      previous = now;
      if (delta > 0 && delta < 1000) frameSamples.push({ time: now, jank: delta > 33.4 ? 1 : 0 });
      if (now - started < FRAME_BURST_MS) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function maybeRunActiveProbe() {
    const snapshot = activitySnapshot(performance.now());
    activeProbeSuppressed = !Runtime.shouldRunActiveProbe(snapshot.state, passiveSignalsAvailable);
    if (!activeProbeSuppressed) runFrameBurst();
  }

  function maintainColdTurns(now, snapshot) {
    if (!Runtime.shouldRunLayoutWork(snapshot.state, snapshot.stableForMs)) return coverageEstimate;
    if (now - lastColdMaintenanceAt < COLD_MAINTENANCE_EVERY_MS) return coverageEstimate;

    const observer = ensureTurnObserver();
    if (!observer) {
      coverageEstimate = null;
      return coverageEstimate;
    }

    lastColdMaintenanceAt = now;
    const nodes = Array.from(currentTargets());
    loadedBlocks = nodes.length;

    for (const tracked of Array.from(trackedTurns)) {
      if (!tracked || tracked.isConnected === false) {
        trackedTurns.delete(tracked);
        try { observer.unobserve(tracked); } catch (_) {}
      }
    }

    for (const node of nodes) {
      if (!trackedTurns.has(node)) {
        trackedTurns.add(node);
        turnMutationAt.set(node, now);
        try { observer.observe(node); } catch (_) {}
      }
    }

    const lastProtected = new Set(nodes.slice(-2));
    let coldCount = 0;

    for (const node of nodes) {
      const nearState = turnNearState.get(node);
      const mutatedAt = turnMutationAt.get(node);
      const recentlyMutated = Number.isFinite(mutatedAt) && now - mutatedAt < COLD_STABLE_MS;
      const canCool =
        optimizationEnabled &&
        nearState === false &&
        !lastProtected.has(node) &&
        !recentlyMutated;

      if (canCool) {
        if (node.getAttribute("data-cgpt-perf-cold") !== "on") {
          node.setAttribute("data-cgpt-perf-cold", "on");
        }
        coldCount += 1;
      } else if (node.hasAttribute("data-cgpt-perf-cold")) {
        node.removeAttribute("data-cgpt-perf-cold");
      }
    }

    coverageEstimate = loadedBlocks
      ? Math.round((coldCount / loadedBlocks) * 100)
      : 0;
    return coverageEstimate;
  }

  function estimateCoverage(now, snapshot) {
    return maintainColdTurns(now, snapshot);
  }

  function collectSignals(now) {
    pruneArray(blockingSamples, now);
    pruneArray(frameSamples, now);
    pruneArray(driftSamples, now);
    pruneInteractions(now);

    let blockingRatio = null;
    let blockingSource = "unknown";
    if (supportsLoAF || supportsLongTask) {
      const blockingMs = blockingSamples.reduce((sum, item) => sum + item.duration, 0);
      blockingRatio = Core.clamp(blockingMs / WINDOW_MS, 0, 1);
      blockingSource = supportsLoAF ? "loaf" : "longtask";
    }

    let jankRatio = null;
    if (frameSamples.length) {
      const jankCount = frameSamples.reduce((sum, item) => sum + item.jank, 0);
      jankRatio = jankCount / frameSamples.length;
    }

    const driftMs = driftSamples.length
      ? Core.average(driftSamples.map((item) => item.drift))
      : null;

    const interactionDurations = Array.from(interactionSamples.values(), (item) => item.duration);
    const eventLatencyMs = interactionDurations.length
      ? Core.percentile(interactionDurations, 0.98)
      : null;

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
    const workStarted = performance.now();
    const now = workStarted;
    totalUpdateTicks += 1;
    const snapshot = activitySnapshot(now);
    activityState = snapshot.state;
    activeProbeSuppressed = !Runtime.shouldRunActiveProbe(activityState, passiveSignalsAvailable);

    if (document.hidden) {
      latest = {
        ...latest,
        status: "background",
        sampledAt: now,
        activityState,
        activeProbeSuppressed: true,
        foregroundRatio: totalUpdateTicks ? foregroundUpdateTicks / totalUpdateTicks : 0
      };
      return;
    }

    foregroundUpdateTicks += 1;
    selfWorkMs = 0;
    const coverage = estimateCoverage(now, snapshot);
    const signals = collectSignals(now);

    const pagePressure = Core.calculatePagePressure({
      blockingRatio: signals.blockingRatio,
      jankRatio: signals.jankRatio,
      driftMs: signals.driftMs,
      eventLatencyMs: signals.eventLatencyMs
    });

    if (pagePressure != null) {
      historySamples.push({ time: now, pressure: pagePressure });
      pruneArray(historySamples, now, Core.CONFIG.HISTORY_MS);
    }

    const windowState = Core.calculateWindowPressure({
      historySamples,
      now,
      currentPressure: pagePressure == null ? 0 : pagePressure,
      loadedBlocks
    });

    const historyAgeMs = Math.max(windowState.historyAgeMs, now - firstSampleAt);
    recommendationState = Core.nextRecommendationState({
      previousState: recommendationState,
      windowPressure: windowState.windowPressure,
      historySamples,
      now,
      transientBusy: windowState.transientBusy,
      historyAgeMs
    });

    const foregroundRatio = totalUpdateTicks ? foregroundUpdateTicks / totalUpdateTicks : 0;
    const supportedSignals =
      Number(supportsLoAF || supportsLongTask) +
      Number(!passiveSignalsAvailable) +
      1 +
      Number(supportsEventTiming);

    selfWorkMs = Math.max(selfWorkMs, performance.now() - workStarted);
    incidents.push({
      time: Math.round(now),
      kind: "sample",
      activityState,
      pagePressure,
      mutationRate: mutationRate(now),
      selfWorkMs: Math.round(selfWorkMs * 10) / 10,
      optimizationEnabled
    });

    latest = {
      pagePressure,
      windowPressure: windowState.windowPressure,
      recommendationState,
      coverage,
      optimizationEnabled,
      status: historyAgeMs < Core.CONFIG.MIN_GUIDANCE_MS ? "sampling" : "running",
      blockingRatio: signals.blockingRatio == null ? null : Math.round(signals.blockingRatio * 1000) / 10,
      blockingSource: signals.blockingSource,
      jankRatio: signals.jankRatio == null ? null : Math.round(signals.jankRatio * 1000) / 10,
      driftMs: signals.driftMs == null ? null : Math.round(signals.driftMs * 10) / 10,
      eventLatencyMs: signals.eventLatencyMs == null ? null : Math.round(signals.eventLatencyMs),
      interactionCount: signals.interactionCount,
      loadedBlocks,
      structureMode,
      transientBusy: windowState.transientBusy,
      historyAgeMs: Math.round(historyAgeMs),
      supportedSignals,
      expectedSignals: 4,
      foregroundRatio,
      sampledAt: now,
      activityState,
      activeProbeSuppressed,
      selfWorkMs: Math.round(selfWorkMs * 10) / 10,
      recentIncidents: incidents.values().slice(-12)
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
        Boolean(currentId) && Boolean(historyCalibration.conversationId) && currentId === historyCalibration.conversationId
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
        sendResponse({ ok: false, error: "历史快照无效" });
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

      sendResponse({ ok: true, calibration: calibrationForCurrentWindow() });
      return true;
    }

    if (message.type === "toggleOptimization") {
      optimizationEnabled = Boolean(message.enabled);
      applyOptimizationState();
      latest = { ...latest, optimizationEnabled };
      sendResponse({ ok: true, metrics: latest });
      return true;
    }
  });

  observeBlocking();
  observeInteractions();
  observeMutations();
  installActivityListeners();
  applyOptimizationState();

  setInterval(sampleDrift, DRIFT_INTERVAL_MS);
  setInterval(maybeRunActiveProbe, ACTIVE_PROBE_EVERY_MS);
  setInterval(updateMetrics, UPDATE_MS);

  document.addEventListener("visibilitychange", () => {
    lastTimerExpected = performance.now() + DRIFT_INTERVAL_MS;
    if (!document.hidden) {
      lastInteractionAt = performance.now();
      applyOptimizationState();
      updateMetrics();
    }
  }, { passive: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      lastInteractionAt = performance.now();
      applyOptimizationState();
      updateMetrics();
    }, { once: true, passive: true });
  } else {
    lastInteractionAt = performance.now();
    applyOptimizationState();
    updateMetrics();
  }
})();
