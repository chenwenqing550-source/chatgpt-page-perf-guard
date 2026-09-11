(() => {
  "use strict";

  const WebExt = globalThis.browser || globalThis.chrome;
  if (!WebExt || !WebExt.runtime || !WebExt.storage || !WebExt.storage.session) return;

  const MAX_CHECKPOINT_EVENTS = 600;
  const MAX_STRING_LENGTH = 180;
  const SESSION_KEY_PREFIX = "blackbox-tab-";
  const ALLOWED_EVENT_KEYS = new Set([
    "kind",
    "wallTimeMs",
    "perfTimeMs",
    "startTime",
    "duration",
    "blockingDuration",
    "firstUIEventTimestamp",
    "renderStart",
    "styleAndLayoutStart",
    "optimizationEnabled",
    "activityState",
    "interactionId",
    "source",
    "marker",
    "scrollY",
    "pagePressure",
    "mutationRate",
    "selfWorkMs",
    "blockingRatio",
    "eventLatencyMs",
    "loadedBlocks",
    "scripts"
  ]);
  const ALLOWED_SCRIPT_KEYS = new Set([
    "duration",
    "forcedStyleAndLayoutDuration",
    "invoker",
    "invokerType",
    "sourceURL",
    "sourceFunctionName",
    "windowAttribution"
  ]);

  function boundedString(value, maxLength = MAX_STRING_LENGTH) {
    if (value == null) return "";
    return String(value).slice(0, maxLength);
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function sanitizeScript(value) {
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const key of ALLOWED_SCRIPT_KEYS) {
      if (!(key in value)) continue;
      if (typeof value[key] === "string") result[key] = boundedString(value[key]);
      else {
        const number = finiteNumber(value[key]);
        if (number != null) result[key] = number;
      }
    }
    return result;
  }

  function sanitizeEvent(value) {
    if (!value || typeof value !== "object") return null;
    const result = {};
    for (const key of ALLOWED_EVENT_KEYS) {
      if (!(key in value)) continue;
      if (key === "scripts") {
        if (!Array.isArray(value.scripts)) continue;
        result.scripts = value.scripts.slice(0, 8).map(sanitizeScript).filter(Boolean);
      } else if (typeof value[key] === "string") {
        result[key] = boundedString(value[key]);
      } else if (typeof value[key] === "boolean") {
        result[key] = value[key];
      } else {
        const number = finiteNumber(value[key]);
        if (number != null) result[key] = number;
      }
    }
    return result;
  }

  function sanitizeSnapshot(snapshot) {
    const value = snapshot && typeof snapshot === "object" ? snapshot : {};
    const conversationId = boundedString(value.conversationId, 64);
    const events = Array.isArray(value.events)
      ? value.events.slice(-MAX_CHECKPOINT_EVENTS).map(sanitizeEvent).filter(Boolean)
      : [];
    return {
      schemaVersion: "1.0",
      savedAt: Date.now(),
      conversationId,
      events
    };
  }

  function senderTabId(sender) {
    const id = sender && sender.tab ? Number(sender.tab.id) : NaN;
    return Number.isInteger(id) && id >= 0 ? id : null;
  }

  function sessionKey(tabId) {
    return `${SESSION_KEY_PREFIX}${tabId}`;
  }

  async function checkpoint(snapshot, sender) {
    const tabId = senderTabId(sender);
    if (tabId == null) return { ok: false, error: "missing-tab" };
    const clean = sanitizeSnapshot(snapshot);
    if (!clean.conversationId) return { ok: false, error: "missing-conversation" };
    await WebExt.storage.session.set({ [sessionKey(tabId)]: clean });
    return { ok: true, savedAt: clean.savedAt, eventCount: clean.events.length };
  }

  async function restore(sender) {
    const tabId = senderTabId(sender);
    if (tabId == null) return { ok: false, error: "missing-tab" };
    const key = sessionKey(tabId);
    const stored = await WebExt.storage.session.get(key);
    const snapshot = stored && stored[key] ? sanitizeSnapshot(stored[key]) : null;
    return { ok: true, snapshot };
  }

  async function clear(sender) {
    const tabId = senderTabId(sender);
    if (tabId == null) return { ok: false, error: "missing-tab" };
    await WebExt.storage.session.remove(sessionKey(tabId));
    return { ok: true };
  }

  WebExt.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;
    let task = null;
    if (message.type === "blackBoxCheckpoint") task = checkpoint(message.snapshot, sender);
    else if (message.type === "blackBoxRestore") task = restore(sender);
    else if (message.type === "blackBoxClear") task = clear(sender);
    else return;

    Promise.resolve(task).then(
      (result) => sendResponse(result),
      () => sendResponse({ ok: false, error: "session-storage-unavailable" })
    );
    return true;
  });
})();
