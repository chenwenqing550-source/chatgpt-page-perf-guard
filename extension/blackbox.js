(() => {
  "use strict";

  const DEFAULT_CAPACITY = 480;
  const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;
  const MAX_STRING_LENGTH = 240;
  const MAX_SCRIPT_ITEMS = 8;
  const CLUSTER_GAP_MS = 2500;
  const SEVERE_DURATION_MS = 100;
  const MIN_CLUSTER_COUNT = 3;

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

  function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function sanitizeString(value, maxLength = MAX_STRING_LENGTH) {
    const limit = Math.max(0, Math.floor(toFiniteNumber(maxLength, MAX_STRING_LENGTH)));
    return String(value == null ? "" : value).slice(0, limit);
  }

  function sanitizeSourceUrl(value) {
    const raw = sanitizeString(value, 512);
    if (!raw) return "";

    try {
      const parsed = new URL(raw);
      parsed.search = "";
      parsed.hash = "";
      return sanitizeString(parsed.toString(), 512);
    } catch (_) {
      const withoutHash = raw.split("#", 1)[0];
      return sanitizeString(withoutHash.split("?", 1)[0], 512);
    }
  }

  function sanitizeScript(script) {
    const item = script && typeof script === "object" ? script : {};
    return {
      duration: Math.max(0, toFiniteNumber(item.duration)),
      forcedStyleAndLayoutDuration: Math.max(0, toFiniteNumber(item.forcedStyleAndLayoutDuration)),
      invoker: sanitizeString(item.invoker),
      invokerType: sanitizeString(item.invokerType, 80),
      sourceURL: sanitizeSourceUrl(item.sourceURL),
      sourceFunctionName: sanitizeString(item.sourceFunctionName, 160),
      windowAttribution: sanitizeString(item.windowAttribution, 80)
    };
  }

  function summarizeLoafScripts(scripts) {
    if (!scripts || typeof scripts[Symbol.iterator] !== "function") return [];
    const result = [];
    for (const script of scripts) {
      result.push(sanitizeScript(script));
      if (result.length >= MAX_SCRIPT_ITEMS) break;
    }
    return result;
  }

  function sanitizeScalar(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return sanitizeString(value);
    if (value == null) return null;
    return undefined;
  }

  function sanitizeData(data) {
    if (!data || typeof data !== "object") return {};
    const result = {};

    for (const [rawKey, value] of Object.entries(data)) {
      const key = sanitizeString(rawKey, 80);
      if (!key || FORBIDDEN_KEYS.has(key)) continue;

      if (key === "scripts") {
        result.scripts = summarizeLoafScripts(value);
        continue;
      }

      const scalar = sanitizeScalar(value);
      if (scalar !== undefined) result[key] = scalar;
    }

    return result;
  }

  function resolveTimestamps(timestamps) {
    const source = timestamps && typeof timestamps === "object" ? timestamps : {};
    const perfFallback = globalThis.performance && typeof globalThis.performance.now === "function"
      ? globalThis.performance.now()
      : 0;
    return {
      perfTimeMs: Math.max(0, toFiniteNumber(source.perfTimeMs, perfFallback)),
      wallTimeMs: Math.max(0, toFiniteNumber(source.wallTimeMs, Date.now()))
    };
  }

  function copyEvent(event) {
    return {
      kind: event.kind,
      perfTimeMs: event.perfTimeMs,
      wallTimeMs: event.wallTimeMs,
      data: {
        ...event.data,
        ...(Array.isArray(event.data.scripts)
          ? { scripts: event.data.scripts.map((item) => ({ ...item })) }
          : {})
      }
    };
  }

  function createRecorder(options = {}) {
    const capacity = Math.max(1, Math.floor(toFiniteNumber(options.capacity, DEFAULT_CAPACITY)));
    const maxAgeMs = Math.max(1000, toFiniteNumber(options.maxAgeMs, DEFAULT_MAX_AGE_MS));
    const slots = new Array(capacity);
    let head = 0;
    let count = 0;

    function physicalIndex(logicalIndex) {
      return (head + logicalIndex) % capacity;
    }

    function prune(nowPerf) {
      const cutoff = toFiniteNumber(nowPerf) - maxAgeMs;
      while (count > 0) {
        const oldest = slots[head];
        if (!oldest || oldest.perfTimeMs >= cutoff) break;
        slots[head] = undefined;
        head = (head + 1) % capacity;
        count -= 1;
      }
    }

    function append(event) {
      if (count < capacity) {
        slots[physicalIndex(count)] = event;
        count += 1;
        return;
      }
      slots[head] = event;
      head = (head + 1) % capacity;
    }

    function resetWith(events) {
      slots.fill(undefined);
      head = 0;
      count = 0;
      const start = Math.max(0, events.length - capacity);
      for (let index = start; index < events.length; index += 1) append(events[index]);
    }

    function record(kind, data = {}, timestamps = {}) {
      const time = resolveTimestamps(timestamps);
      const event = {
        kind: sanitizeString(kind, 64) || "unknown",
        perfTimeMs: time.perfTimeMs,
        wallTimeMs: time.wallTimeMs,
        data: sanitizeData(data)
      };
      append(event);
      return copyEvent(event);
    }

    function markSend(source, timestamps = {}) {
      return record("send", { source: sanitizeString(source, 32) }, timestamps);
    }

    function markManual(timestamps = {}) {
      return record("manual", {}, timestamps);
    }

    function snapshot(nowPerf) {
      const newest = count > 0 ? slots[physicalIndex(count - 1)] : null;
      const resolvedNow = Number.isFinite(Number(nowPerf))
        ? Number(nowPerf)
        : (newest ? newest.perfTimeMs : 0);
      prune(resolvedNow);
      const result = new Array(count);
      for (let index = 0; index < count; index += 1) {
        result[index] = copyEvent(slots[physicalIndex(index)]);
      }
      return result;
    }

    function restore(sourceEvents, context = {}) {
      if (!Array.isArray(sourceEvents) || !sourceEvents.length) return { restored: 0, skipped: 0 };
      const nowPerf = Math.max(0, toFiniteNumber(context.nowPerf));
      const wallTimeMs = Math.max(0, toFiniteNumber(context.wallTimeMs, Date.now()));
      const merged = snapshot(nowPerf);
      let restored = 0;
      let skipped = 0;

      for (const sourceEvent of sourceEvents) {
        if (!sourceEvent || typeof sourceEvent !== "object") {
          skipped += 1;
          continue;
        }
        const sourceWall = Math.max(0, toFiniteNumber(sourceEvent.wallTimeMs));
        if (!sourceWall) {
          skipped += 1;
          continue;
        }
        const ageMs = wallTimeMs - sourceWall;
        if (ageMs > maxAgeMs || ageMs < -5000) {
          skipped += 1;
          continue;
        }
        merged.push({
          kind: sanitizeString(sourceEvent.kind, 64) || "unknown",
          perfTimeMs: nowPerf - ageMs,
          wallTimeMs: sourceWall,
          data: sanitizeData(sourceEvent.data)
        });
        restored += 1;
      }

      merged.sort((a, b) => {
        const wallDelta = a.wallTimeMs - b.wallTimeMs;
        return wallDelta || a.perfTimeMs - b.perfTimeMs;
      });
      resetWith(merged);
      prune(nowPerf);
      return { restored, skipped };
    }

    function latestMarker(markerKind, nowPerf) {
      const current = snapshot(nowPerf);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (current[index].kind === markerKind) return current[index];
      }
      return null;
    }

    function sliceAroundMarker(markerKind, beforeMs, afterMs, nowPerf) {
      const current = snapshot(nowPerf);
      let marker = null;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (current[index].kind === markerKind) {
          marker = current[index];
          break;
        }
      }

      if (!marker) return { marker: null, events: [] };
      const start = marker.perfTimeMs - Math.max(0, toFiniteNumber(beforeMs));
      const end = marker.perfTimeMs + Math.max(0, toFiniteNumber(afterMs));
      return {
        marker: copyEvent(marker),
        events: current
          .filter((event) => event.perfTimeMs >= start && event.perfTimeMs <= end)
          .map(copyEvent)
      };
    }

    function blockingDuration(event) {
      if (!event || (event.kind !== "long-animation-frame" && event.kind !== "longtask")) return 0;
      return Math.max(0, toFiniteNumber(event.data && event.data.duration));
    }

    function detectSevereClusters(nowPerf) {
      const blocking = snapshot(nowPerf)
        .filter((event) => blockingDuration(event) >= SEVERE_DURATION_MS)
        .sort((a, b) => a.perfTimeMs - b.perfTimeMs);
      const clusters = [];
      let bucket = [];

      function flush() {
        if (bucket.length < MIN_CLUSTER_COUNT) {
          bucket = [];
          return;
        }
        const durations = bucket.map(blockingDuration);
        clusters.push({
          startPerfTimeMs: bucket[0].perfTimeMs,
          endPerfTimeMs: bucket[bucket.length - 1].perfTimeMs,
          count: bucket.length,
          maxDuration: Math.max(...durations),
          totalDuration: durations.reduce((sum, value) => sum + value, 0)
        });
        bucket = [];
      }

      for (const event of blocking) {
        if (!bucket.length || event.perfTimeMs - bucket[bucket.length - 1].perfTimeMs <= CLUSTER_GAP_MS) {
          bucket.push(event);
        } else {
          flush();
          bucket.push(event);
        }
      }
      flush();
      return clusters;
    }

    function buildExport(kind, context = {}) {
      const current = snapshot(context.nowPerf);
      const nowPerf = Number.isFinite(Number(context.nowPerf))
        ? Number(context.nowPerf)
        : (current.length ? current[current.length - 1].perfTimeMs : 0);
      let selected;
      let marker = null;

      if (kind === "send" || kind === "manual") {
        const sliced = sliceAroundMarker(kind, 10000, 20000, nowPerf);
        marker = sliced.marker;
        selected = sliced.events;
      } else {
        selected = current;
      }

      const clusters = detectSevereClusters(nowPerf);
      return {
        schemaVersion: 1,
        exportedAt: sanitizeString(context.exportedAt || new Date().toISOString(), 64),
        pageTimeOrigin: sanitizeString(context.pageTimeOrigin || "", 64),
        conversationId: sanitizeString(context.conversationId || "", 80) || null,
        optimizationEnabled: Boolean(context.optimizationEnabled),
        captureWindow: kind === "send" || kind === "manual" ? kind : "recent",
        privacy: {
          chatTextCaptured: false,
          promptTextCaptured: false,
          assistantTextCaptured: false,
          uploaded: false
        },
        summary: {
          eventCount: selected.length,
          totalBufferedEvents: current.length,
          severeClusterCount: clusters.length,
          latestSevereCluster: clusters.length ? { ...clusters[clusters.length - 1] } : null,
          marker: marker ? copyEvent(marker) : null
        },
        events: selected.map(copyEvent)
      };
    }

    return {
      record,
      markSend,
      markManual,
      snapshot,
      restore,
      latestMarker,
      sliceAroundMarker,
      detectSevereClusters,
      buildExport
    };
  }

  globalThis.CGPTPerfBlackBox = {
    createRecorder,
    sanitizeString,
    sanitizeSourceUrl,
    summarizeLoafScripts
  };
})();
