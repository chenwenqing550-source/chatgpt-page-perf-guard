(() => {
  "use strict";

  const DEFAULT_MAX_ITEMS = 900;
  const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
  const MAX_STRING_LENGTH = 180;
  const MAX_SCRIPT_ITEMS = 8;

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function roundTenth(value) {
    return Math.round(finiteNumber(value) * 10) / 10;
  }

  function boundedString(value, maxLength = MAX_STRING_LENGTH) {
    if (value == null) return "";
    const text = String(value);
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength);
  }

  function sanitizeSourceUrl(value) {
    const raw = boundedString(value, 2048);
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      parsed.search = "";
      parsed.hash = "";
      return boundedString(parsed.toString());
    } catch (_) {
      return boundedString(raw.split(/[?#]/, 1)[0]);
    }
  }

  function sanitizeScript(script) {
    const item = script || {};
    return {
      duration: roundTenth(item.duration),
      forcedStyleAndLayoutDuration: roundTenth(item.forcedStyleAndLayoutDuration),
      invoker: boundedString(item.invoker),
      invokerType: boundedString(item.invokerType, 80),
      sourceURL: sanitizeSourceUrl(item.sourceURL),
      sourceFunctionName: boundedString(item.sourceFunctionName),
      windowAttribution: boundedString(item.windowAttribution, 80)
    };
  }

  function sanitizeLoafEntry(entry, context = {}) {
    const value = entry || {};
    const scripts = Array.from(value.scripts || [])
      .slice(0, MAX_SCRIPT_ITEMS)
      .map(sanitizeScript);

    return {
      kind: "long-animation-frame",
      wallTimeMs: finiteNumber(context.wallTimeMs, Date.now()),
      perfTimeMs: roundTenth(
        context.perfTimeMs == null
          ? finiteNumber(value.startTime) + finiteNumber(value.duration)
          : context.perfTimeMs
      ),
      startTime: roundTenth(value.startTime),
      duration: roundTenth(value.duration),
      blockingDuration: roundTenth(value.blockingDuration),
      firstUIEventTimestamp: roundTenth(value.firstUIEventTimestamp),
      renderStart: roundTenth(value.renderStart),
      styleAndLayoutStart: roundTenth(value.styleAndLayoutStart),
      optimizationEnabled: Boolean(context.optimizationEnabled),
      activityState: boundedString(context.activityState, 40),
      scripts
    };
  }

  function createRecorder(options = {}) {
    const maxItems = Math.max(1, Math.floor(finiteNumber(options.maxItems, DEFAULT_MAX_ITEMS)));
    const windowMs = Math.max(1, finiteNumber(options.windowMs, DEFAULT_WINDOW_MS));
    const nowWall = typeof options.nowWall === "function" ? options.nowWall : () => Date.now();
    const nowPerf = typeof options.nowPerf === "function"
      ? options.nowPerf
      : () => (globalThis.performance && typeof globalThis.performance.now === "function"
        ? globalThis.performance.now()
        : 0);

    const slots = new Array(maxItems);
    let writeIndex = 0;
    let size = 0;

    function normalizeEvent(event = {}) {
      const normalized = {};
      for (const [key, value] of Object.entries(event)) {
        if (typeof value === "string") normalized[key] = boundedString(value);
        else if (Array.isArray(value)) normalized[key] = value.slice(0, MAX_SCRIPT_ITEMS);
        else if (value && typeof value === "object") normalized[key] = value;
        else normalized[key] = value;
      }

      normalized.kind = boundedString(event.kind || "unknown", 64);
      normalized.wallTimeMs = finiteNumber(event.wallTimeMs, nowWall());
      normalized.perfTimeMs = roundTenth(
        event.perfTimeMs == null ? nowPerf() : event.perfTimeMs
      );
      return normalized;
    }

    function append(normalized) {
      slots[writeIndex] = normalized;
      writeIndex = (writeIndex + 1) % maxItems;
      if (size < maxItems) size += 1;
    }

    function snapshotAll() {
      const result = [];
      const start = (writeIndex - size + maxItems) % maxItems;
      for (let index = 0; index < size; index += 1) {
        const item = slots[(start + index) % maxItems];
        if (item) result.push(item);
      }
      return result;
    }

    function activeEvents(referenceWallMs = nowWall()) {
      const cutoff = finiteNumber(referenceWallMs) - windowMs;
      return snapshotAll().filter((item) => finiteNumber(item.wallTimeMs) >= cutoff);
    }

    function record(event) {
      const normalized = normalizeEvent(event);
      append(normalized);
      return normalized;
    }

    function mark(kind, details = {}) {
      return record({
        ...details,
        kind: boundedString(kind || "marker", 64),
        marker: true
      });
    }

    function hydrate(events) {
      if (!Array.isArray(events)) return 0;
      const existing = snapshotAll();
      const seen = new Set(
        existing.map((item) => `${item.wallTimeMs}|${item.perfTimeMs}|${item.kind}|${item.duration || ""}`)
      );
      const merged = existing.slice();
      let added = 0;

      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        const normalized = normalizeEvent(event);
        const key = `${normalized.wallTimeMs}|${normalized.perfTimeMs}|${normalized.kind}|${normalized.duration || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(normalized);
        added += 1;
      }

      const cutoff = finiteNumber(nowWall()) - windowMs;
      const retained = merged
        .filter((item) => finiteNumber(item.wallTimeMs) >= cutoff)
        .sort((a, b) => a.wallTimeMs - b.wallTimeMs || a.perfTimeMs - b.perfTimeMs)
        .slice(-maxItems);

      slots.fill(undefined);
      writeIndex = 0;
      size = 0;
      for (const item of retained) append(item);
      return added;
    }

    function events() {
      return activeEvents().map((item) => ({ ...item }));
    }

    function latestMarker(kinds) {
      const accepted = new Set(Array.isArray(kinds) ? kinds : [kinds]);
      const current = activeEvents();
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const item = current[index];
        if (item && item.marker === true && accepted.has(item.kind)) return { ...item };
      }
      return null;
    }

    function findSevereClusters(config = {}) {
      const minDurationMs = Math.max(1, finiteNumber(config.minDurationMs, 100));
      const minCount = Math.max(2, Math.floor(finiteNumber(config.minCount, 3)));
      const clusterWindowMs = Math.max(100, finiteNumber(config.windowMs, 2000));
      const blocking = activeEvents().filter((item) => (
        (item.kind === "long-animation-frame" || item.kind === "longtask") &&
        finiteNumber(item.duration) >= minDurationMs
      ));
      const clusters = [];
      let start = 0;

      while (start < blocking.length) {
        let end = start;
        while (
          end + 1 < blocking.length &&
          finiteNumber(blocking[end + 1].wallTimeMs) - finiteNumber(blocking[start].wallTimeMs) <= clusterWindowMs
        ) {
          end += 1;
        }

        const count = end - start + 1;
        if (count >= minCount) {
          const group = blocking.slice(start, end + 1);
          clusters.push({
            startWallTimeMs: finiteNumber(group[0].wallTimeMs),
            endWallTimeMs: finiteNumber(group.at(-1).wallTimeMs),
            count,
            maxDurationMs: Math.max(...group.map((item) => finiteNumber(item.duration))),
            totalDurationMs: Math.round(group.reduce((sum, item) => sum + finiteNumber(item.duration), 0))
          });
          start = end + 1;
        } else {
          start += 1;
        }
      }

      return clusters;
    }

    function exportRecent(referenceWallMs = nowWall()) {
      return {
        marker: null,
        events: activeEvents(referenceWallMs).map((item) => ({ ...item }))
      };
    }

    function exportAroundLatestMarker(kinds, beforeMs = 10_000, afterMs = 20_000) {
      const marker = latestMarker(kinds);
      if (!marker) return { marker: null, events: [] };
      const start = marker.wallTimeMs - Math.max(0, finiteNumber(beforeMs));
      const end = marker.wallTimeMs + Math.max(0, finiteNumber(afterMs));
      return {
        marker,
        events: activeEvents(marker.wallTimeMs + Math.max(0, finiteNumber(afterMs)))
          .filter((item) => item.wallTimeMs >= start && item.wallTimeMs <= end)
          .map((item) => ({ ...item }))
      };
    }

    return Object.freeze({
      record,
      mark,
      hydrate,
      events,
      latestMarker,
      findSevereClusters,
      exportRecent,
      exportAroundLatestMarker
    });
  }

  globalThis.CGPTPerfBlackBox = Object.freeze({
    DEFAULT_MAX_ITEMS,
    DEFAULT_WINDOW_MS,
    MAX_SCRIPT_ITEMS,
    boundedString,
    sanitizeSourceUrl,
    sanitizeLoafEntry,
    createRecorder
  });
})();
