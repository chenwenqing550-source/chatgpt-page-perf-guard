(() => {
  "use strict";

  const WebExt = globalThis.browser || globalThis.chrome;
  if (!WebExt || !WebExt.runtime || !WebExt.storage || !WebExt.storage.session) return;

  const session = WebExt.storage.session;
  const PREFIX = "cgpt-perf-blackbox-tab:";
  const MAX_EVENTS = 480;
  const MAX_STRING = 240;
  const MAX_SCRIPTS = 8;
  const FORBIDDEN_KEYS = new Set([
    "text",
    "content",
    "innerHTML",
    "outerHTML",
    "promptText",
    "assistantText",
    "chatText",
    "clipboardData",
    "html"
  ]);

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function safeString(value, limit = MAX_STRING) {
    return String(value == null ? "" : value).slice(0, Math.max(0, limit));
  }

  function safeScript(value) {
    const script = value && typeof value === "object" ? value : {};
    return {
      duration: Math.max(0, finiteNumber(script.duration)),
      forcedStyleAndLayoutDuration: Math.max(0, finiteNumber(script.forcedStyleAndLayoutDuration)),
      invoker: safeString(script.invoker),
      invokerType: safeString(script.invokerType, 80),
      sourceURL: safeString(script.sourceURL, 512),
      sourceFunctionName: safeString(script.sourceFunctionName, 160),
      windowAttribution: safeString(script.windowAttribution, 80)
    };
  }

  function safeData(value) {
    if (!value || typeof value !== "object") return {};
    const result = {};
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = safeString(rawKey, 80);
      if (!key || FORBIDDEN_KEYS.has(key)) continue;
      if (key === "scripts" && Array.isArray(rawValue)) {
        result.scripts = rawValue.slice(0, MAX_SCRIPTS).map(safeScript);
        continue;
      }
      if (typeof rawValue === "number") {
        result[key] = Number.isFinite(rawValue) ? rawValue : 0;
      } else if (typeof rawValue === "boolean") {
        result[key] = rawValue;
      } else if (typeof rawValue === "string") {
        result[key] = safeString(rawValue);
      } else if (rawValue == null) {
        result[key] = null;
      }
    }
    return result;
  }

  function safeEvent(value) {
    const event = value && typeof value === "object" ? value : {};
    return {
      kind: safeString(event.kind, 64) || "unknown",
      perfTimeMs: Math.max(0, finiteNumber(event.perfTimeMs)),
      wallTimeMs: Math.max(0, finiteNumber(event.wallTimeMs)),
      data: safeData(event.data)
    };
  }

  function safeCheckpoint(value) {
    const checkpoint = value && typeof value === "object" ? value : {};
    const sourceEvents = Array.isArray(checkpoint.events) ? checkpoint.events : [];
    return {
      schemaVersion: 1,
      conversationId: safeString(checkpoint.conversationId, 80) || null,
      savedAt: Math.max(0, finiteNumber(checkpoint.savedAt)),
      events: sourceEvents.slice(-MAX_EVENTS).map(safeEvent)
    };
  }

  function keyForSender(sender) {
    const tabId = sender && sender.tab && Number(sender.tab.id);
    return Number.isInteger(tabId) && tabId >= 0 ? `${PREFIX}${tabId}` : null;
  }

  async function loadCheckpoint(key) {
    const stored = await session.get(key);
    return stored && stored[key] ? safeCheckpoint(stored[key]) : null;
  }

  WebExt.runtime.onMessage.addListener(async (message, sender) => {
    if (!message || typeof message.type !== "string") return undefined;
    const key = keyForSender(sender);
    if (!key) return { ok: false, error: "NO_TAB_CONTEXT" };

    if (message.type === "saveBlackBoxCheckpoint") {
      const checkpoint = safeCheckpoint(message.checkpoint);
      await session.set({ [key]: checkpoint });
      return { ok: true, savedAt: checkpoint.savedAt, eventCount: checkpoint.events.length };
    }

    if (message.type === "loadBlackBoxCheckpoint") {
      return { ok: true, checkpoint: await loadCheckpoint(key) };
    }

    if (message.type === "clearBlackBoxCheckpoint") {
      await session.remove(key);
      return { ok: true };
    }

    return undefined;
  });
})();
