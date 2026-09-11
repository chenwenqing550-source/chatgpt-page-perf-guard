(() => {
  "use strict";

  const STABLE_RESUME_MS = 2500;
  const INTERACTION_GUARD_MS = 2500;
  const GENERATING_MUTATIONS_PER_SEC = 6;
  const BUSY_BLOCKING_MS = 80;

  function classifyActivityState({
    hidden = false,
    scrollActive = false,
    mutationRate = 0,
    recentBlockingMs = 0,
    stableForMs = Infinity,
    interactionAgeMs = Infinity
  } = {}) {
    if (hidden) return "background";

    const generating = Number(mutationRate) >= GENERATING_MUTATIONS_PER_SEC;
    const blocked = Number(recentBlockingMs) >= BUSY_BLOCKING_MS;
    const recentInteraction = Number(interactionAgeMs) < INTERACTION_GUARD_MS;

    if (scrollActive && (generating || blocked || recentInteraction)) return "busy";
    if (scrollActive) return "scrolling";
    if (generating) return "generating";
    if (blocked || recentInteraction) return "busy";
    if (Number(stableForMs) < STABLE_RESUME_MS) return "busy";
    return "quiet";
  }

  function shouldRunActiveProbe(state, passiveSignalsAvailable) {
    return state === "quiet" && !passiveSignalsAvailable;
  }

  function shouldRunLayoutWork(state, stableForMs) {
    return state === "quiet" && Number(stableForMs) >= STABLE_RESUME_MS;
  }

  function createRingBuffer(maxItems = 80) {
    const limit = Math.max(1, Math.trunc(Number(maxItems) || 1));
    const items = [];

    return Object.freeze({
      push(value) {
        items.push(value);
        if (items.length > limit) items.splice(0, items.length - limit);
      },
      values() {
        return items.slice();
      },
      clear() {
        items.length = 0;
      }
    });
  }

  globalThis.CGPTPerfRuntime = Object.freeze({
    STABLE_RESUME_MS,
    INTERACTION_GUARD_MS,
    GENERATING_MUTATIONS_PER_SEC,
    BUSY_BLOCKING_MS,
    classifyActivityState,
    shouldRunActiveProbe,
    shouldRunLayoutWork,
    createRingBuffer
  });
})();
