(() => {
  "use strict";

  const Core = globalThis.CGPTPerfCore;
  const Runtime = globalThis.CGPTPerfRuntime;
  const BlackBox = globalThis.CGPTPerfBlackBox;
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
  const BLACK_BOX_WINDOW_MS = 10 * 60 * 1000;
  const BLACK_BOX_MAX_ITEMS = 900;
  const BLACK_BOX_SCROLL_SAMPLE_MS = 250;
  const SEND_DEDUPE_MS = 250;
  const BLACK_BOX_CHECKPOINT_MS = 30000;
  const BLACK_BOX_CHECKPOINT_BACKOFF_MS = 120000;
  const BLACK_BOX_CHECKPOINT_BUDGET_MS = 8;
  const BLACK_BOX_CHECKPOINT_MAX_ITEMS = 600;

  function createNoopBlackBoxRecorder() {
    return Object.freeze({
      record: () => null,
      mark: () => null,
      hydrate: () => 0,
      events: () => [],
      latestMarker: () => null,
      findSevereClusters: () => [],
      exportRecent: () => ({ marker: null, events: [] }),
      exportAroundLatestMarker: () => ({ marker: null, events: [] })
    });
  }

  const blackBoxAvailable = Boolean(BlackBox && typeof BlackBox.createRecorder === "function");
  const blackBox = blackBoxAvailable
    ? BlackBox.createRecorder({ maxItems: BLACK_BOX_MAX_ITEMS, windowMs: BLACK_BOX_WINDOW_MS })
    : createNoopBlackBoxRecorder();

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
  let lastSendMarkerAt = -Infinity;
  let lastBlackBoxScrollAt = -Infinity;
  let selfWorkMs = 0;
  let activityState = "quiet";
  let activeProbeSuppressed = true;
  let turnObserver = null;

  let lastCheckpointAt = -Infinity;
  let checkpointBackoffUntil = -Infinity;
  let checkpointDispatchMs = 0;
  let checkpointInFlight = false;
  let checkpointAvailable = false;
  let checkpointStatus = "not-restored";
  let restoreAttemptedConversationId = null;
  let restoreSettledConversationId = null;
  let pendingSevereCheckpoint = false;
  let severeWindowStart = -Infinity;
  let severeWindowCount = 0;

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

  function wallTimeForPerf(perfTime) {
    const origin = Number(performance.timeOrigin);
    if (Number.isFinite(origin)) return Math.round(origin + Number(perfTime || 0));
    return Math.round(Date.now() - performance.now() + Number(perfTime || 0));
  }

  function safeBlackBoxRecord(event) {
    try {
      return blackBox.record(event);
    } catch (_) {
      return null;
    }
  }

  function safeBlackBoxMark(kind, details) {
    try {
      return blackBox.mark(kind, details);
    } catch (_) {
      return null;
    }
  }

  function sendRuntimeMessage(message) {
    try {
      const result = WebExt.runtime.sendMessage(message);
      if (result && typeof result.then === "function") return result;
      return Promise.resolve(result || null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

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

  function noteSevereBlocking(eventTime, duration) {
    if (duration < 100) return;
    if (eventTime - severeWindowStart > 2000) {
      severeWindowStart = eventTime;
      severeWindowCount = 1;
    } else {
      severeWindowCount += 1;
    }
    if (duration >= 250 || severeWindowCount >= 3) pendingSevereCheckpoint = true;
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
          noteSevereBlocking(eventTime, duration);

          if (type === "long-animation-frame" && BlackBox && typeof BlackBox.sanitizeLoafEntry === "function") {
            safeBlackBoxRecord(BlackBox.sanitizeLoafEntry(entry, {
              wallTimeMs: wallTimeForPerf(eventTime),
              perfTimeMs: eventTime,
              optimizationEnabled,
              activityState
            }));
          } else {
            safeBlackBoxRecord({
              kind: type,
              wallTimeMs: wallTimeForPerf(eventTime),
              perfTimeMs: eventTime,
              duration: Math.round(duration * 10) / 10,
              optimizationEnabled,
              activityState
            });
          }

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
          if (duration >= 80) {
            safeBlackBoxRecord({
              kind: "event-timing",
              wallTimeMs: wallTimeForPerf(eventTime),
              perfTimeMs: eventTime,
              duration: Math.round(duration * 10) / 10,
              interactionId,
              activityState,
              optimizationEnabled
            });
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

  function markSend(details) {
    const now = performance.now();
    lastInteractionAt = now;
    if (now - lastSendMarkerAt < SEND_DEDUPE_MS) return;
    lastSendMarkerAt = now;
    safeBlackBoxMark("send", { ...details, wallTimeMs: wallTimeForPerf(now), perfTimeMs: now, activityState, optimizationEnabled });
  }

  function markScroll() {
    const now = performance.now();
    lastScrollAt = now;
    if (now - lastBlackBoxScrollAt < BLACK_BOX_SCROLL_SAMPLE_MS) return;
    lastBlackBoxScrollAt = now;
    const scrollY = Number(globalThis.scrollY);
    safeBlackBoxMark("scroll", { wallTimeMs: wallTimeForPerf(now), perfTimeMs: now, scrollY: Number.isFinite(scrollY) ? Math.round(scrollY) : null, activityState, optimizationEnabled });
  }

  function installActivityListeners() {
    const passive = { passive: true, capture: true };
    for (const type of ["pointerdown", "input", "click"]) {
      document.addEventListener(type, markInteraction, passive);
    }
    document.addEventListener("keydown", (event) => {
      markInteraction();
      if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
        markSend({ source: "enter" });
      }
    }, passive);
    document.addEventListener("submit", () => markSend({ source: "submit" }), passive);
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

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  }

  function maybeRestoreBlackBox() {
    if (!blackBoxAvailable || document.hidden || activityState !== "quiet") return;
    const conversationId = currentConversationId();
    if (!conversationId || restoreAttemptedConversationId === conversationId) return;
    restoreAttemptedConversationId = conversationId;
    restoreSettledConversationId = null;
    checkpointStatus = "restoring";

    sendRuntimeMessage({ type: "blackBoxRestore" }).then((response) => {
      const snapshot = response && response.ok ? response.snapshot : null;
      if (!snapshot) {
        checkpointStatus = response && response.ok ? "empty" : "unavailable";
        restoreSettledConversationId = conversationId;
        return;
      }
      if (snapshot.conversationId !== conversationId) {
        checkpointStatus = "conversation-mismatch";
        restoreSettledConversationId = conversationId;
        return;
      }
      try {
        blackBox.hydrate(snapshot.events);
        checkpointAvailable = true;
        checkpointStatus = "restored";
      } catch (_) {
        checkpointStatus = "restore-failed";
      }
      restoreSettledConversationId = conversationId;
    }, () => {
      checkpointStatus = "unavailable";
      restoreSettledConversationId = conversationId;
    });
  }

  function maybeCheckpointBlackBox(now) {
    if (!blackBoxAvailable || document.hidden || activityState !== "quiet") return;
    if (checkpointInFlight || now < checkpointBackoffUntil) return;
    const conversationId = currentConversationId();
    if (!conversationId || restoreSettledConversationId !== conversationId) return;
    const due = pendingSevereCheckpoint || now - lastCheckpointAt >= BLACK_BOX_CHECKPOINT_MS;
    if (!due) return;

    let events;
    try {
      events = blackBox.events().slice(-BLACK_BOX_CHECKPOINT_MAX_ITEMS);
    } catch (_) {
      checkpointStatus = "snapshot-failed";
      checkpointBackoffUntil = now + BLACK_BOX_CHECKPOINT_BACKOFF_MS;
      return;
    }
    if (!events.length) return;

    const dispatchStarted = performance.now();
    const task = sendRuntimeMessage({
      type: "blackBoxCheckpoint",
      snapshot: {
        schemaVersion: "1.0",
        conversationId,
        savedAt: Date.now(),
        events
      }
    });
    checkpointDispatchMs = Math.max(0, performance.now() - dispatchStarted);
    if (checkpointDispatchMs > BLACK_BOX_CHECKPOINT_BUDGET_MS) {
      checkpointBackoffUntil = now + BLACK_BOX_CHECKPOINT_BACKOFF_MS;
    }
    checkpointInFlight = true;
    checkpointStatus = "saving";

    Promise.resolve(task).then((response) => {
      checkpointInFlight = false;
      if (response && response.ok) {
        lastCheckpointAt = performance.now();
        checkpointAvailable = true;
        checkpointStatus = "saved";
        pendingSevereCheckpoint = false;
      } else {
        checkpointStatus = "save-failed";
        checkpointBackoffUntil = Math.max(checkpointBackoffUntil, performance.now() + BLACK_BOX_CHECKPOINT_BACKOFF_MS);
      }
    }, () => {
      checkpointInFlight = false;
      checkpointStatus = "save-failed";
      checkpointBackoffUntil = Math.max(checkpointBackoffUntil, performance.now() + BLACK_BOX_CHECKPOINT_BACKOFF_MS);
    });
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

    const currentMutationRate = mutationRate(now);
    const preBlackBoxWorkMs = Math.max(0, performance.now() - workStarted);
    safeBlackBoxRecord({
      kind: "sample",
      wallTimeMs: wallTimeForPerf(now),
      perfTimeMs: now,
      activityState,
      pagePressure,
      mutationRate: currentMutationRate,
      selfWorkMs: Math.round(preBlackBoxWorkMs * 10) / 10,
      blockingRatio: signals.blockingRatio == null ? null : Math.round(signals.blockingRatio * 1000) / 10,
      eventLatencyMs: signals.eventLatencyMs == null ? null : Math.round(signals.eventLatencyMs),
      loadedBlocks,
      optimizationEnabled
    });

    maybeRestoreBlackBox();
    maybeCheckpointBlackBox(now);

    selfWorkMs = Math.max(selfWorkMs, performance.now() - workStarted);
    incidents.push({
      time: Math.round(now),
      kind: "sample",
      activityState,
      pagePressure,
      mutationRate: currentMutationRate,
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

  function calibrationForCurrentWindow() {
    if (!historyCalibration) return null;
    const currentId = currentConversationId();
    return {
      ...historyCalibration,
      matchesCurrentConversation:
        Boolean(currentId) && Boolean(historyCalibration.conversationId) && currentId === historyCalibration.conversationId
    };
  }

  function blackBoxStatus() {
    let events = [];
    let clusters = [];
    let latestSend = null;
    let latestManual = null;
    try {
      events = blackBox.events();
      clusters = blackBox.findSevereClusters();
      latestSend = blackBox.latestMarker(["send"]);
      latestManual = blackBox.latestMarker(["manual-jank"]);
    } catch (_) {
      // Diagnostics must never break the primary monitor.
    }
    return {
      available: blackBoxAvailable,
      eventCount: events.length,
      latestSendWallTimeMs: latestSend ? latestSend.wallTimeMs : null,
      latestManualWallTimeMs: latestManual ? latestManual.wallTimeMs : null,
      latestCluster: clusters.length ? clusters[clusters.length - 1] : null,
      sessionCheckpoint: checkpointStatus,
      checkpointAvailable,
      checkpointDispatchMs: Math.round(checkpointDispatchMs * 10) / 10
    };
  }

  function buildBlackBoxExport(mode) {
    const captureWindow = mode === "send" || mode === "manual" ? mode : "recent";
    let slice = { marker: null, events: [] };
    if (captureWindow === "send") slice = blackBox.exportAroundLatestMarker(["send"], 10_000, 20_000);
    else if (captureWindow === "manual") slice = blackBox.exportAroundLatestMarker(["manual-jank"], 30_000, 30_000);
    else slice = blackBox.exportRecent(Date.now());

    const clusters = blackBox.findSevereClusters();
    return {
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      pageTimeOrigin: Number.isFinite(Number(performance.timeOrigin))
        ? new Date(Number(performance.timeOrigin)).toISOString()
        : null,
      conversationId: currentConversationId(),
      optimizationEnabled,
      captureWindow,
      privacy: {
        containsChatText: false,
        localOnly: true,
        networkUpload: false
      },
      summary: {
        eventCount: slice.events.length,
        marker: slice.marker,
        severeClusterCount: clusters.length,
        latestSevereCluster: clusters.length ? clusters[clusters.length - 1] : null,
        sessionCheckpoint: checkpointStatus
      },
      events: slice.events
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

    if (message.type === "getBlackBoxStatus") {
      sendResponse({ ok: true, status: blackBoxStatus() });
      return true;
    }

    if (message.type === "markBlackBoxJank") {
      const now = performance.now();
      safeBlackBoxMark("manual-jank", {
        source: "popup",
        wallTimeMs: wallTimeForPerf(now),
        perfTimeMs: now,
        activityState,
        optimizationEnabled
      });
      pendingSevereCheckpoint = true;
      sendResponse({ ok: true, status: blackBoxStatus() });
      return true;
    }

    if (message.type === "getBlackBoxExport") {
      try {
        sendResponse({ ok: true, payload: buildBlackBoxExport(message.mode) });
      } catch (_) {
        sendResponse({ ok: false, error: "诊断数据导出失败" });
      }
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
