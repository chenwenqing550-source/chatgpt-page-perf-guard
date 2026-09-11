# Diagnostic Black Box v1.7.1 Design

## Goal
Add a low-overhead, local-only diagnostic black box that can capture the seconds around send-time freezes and export enough performance evidence to distinguish native ChatGPT layout churn from extension amplification, without making v1.7 runtime performance worse.

## Scope
This candidate adds diagnostics only. It does **not** change the existing cold-turn optimization algorithm, thresholds, or recommendation policy in the same patch. Any later performance fix must be evidence-driven from the captured incident timeline.

## Observed failure signature
Field evidence shows intermittent UI freezes, including a reproducible case at the instant a message is sent. One freeze contained a short cluster of 20 forced-reflow violations, including 375 ms and 364 ms events, plus six page-bundle `message` handlers around 150–165 ms. Long code streaming can also complete without a visible freeze, so output length alone is not a sufficient trigger. The black box must therefore preserve event clusters and send markers, not only the latest single long frame.

## Architecture
### 1. Hot-path recorder
Create `extension/blackbox.js` as a pure, bounded recorder loaded before `monitor.js`.

The recorder stores compact metadata only:
- `wallTimeMs` from `Date.now()`.
- `perfTimeMs` from `performance.now()` or browser PerformanceEntry timestamps.
- event kind and bounded numeric/string metadata.
- current activity state and optimization state when available.

Hard hot-path rules:
- O(1) append into a fixed-capacity ring buffer.
- No `JSON.stringify` in input/submit/scroll/PerformanceObserver callbacks.
- No `getBoundingClientRect`, `offset*`, `client*`, `scrollHeight`, computed-style reads, or DOM-wide scans.
- No extension-storage writes in send/input/scroll callbacks.
- No chat text, prompt text, assistant text, DOM HTML, clipboard data, cookies, or network telemetry.

### 2. Event sources
Reuse existing signals instead of creating high-frequency probes:
- Long Animation Frame / LongTask observer.
- Event Timing observer.
- Mutation rate already collected by `monitor.js`.
- existing two-second metrics update.
- `submit` and Enter-key markers.
- `scroll` markers, recording only lightweight position metadata such as `scrollY` when available.

For Long Animation Frames, capture browser-provided metadata without causing layout work:
- `duration`, `blockingDuration`, `renderStart`, `styleAndLayoutStart`, `firstUIEventTimestamp`.
- bounded script summaries (maximum 8) containing duration, forced-style/layout duration, invoker type/name, sanitized source URL, function name, and window attribution.

Source URLs must have query strings and fragments removed and strings must be length-bounded.

### 3. Incident clustering
The recorder identifies a severe cluster when multiple blocking events occur within a short window. The export format highlights the nearest send marker and provides:
- pre-send context: approximately 10 seconds.
- post-send context: approximately 20 seconds.
- recent background timeline: up to 10 minutes.

A single long frame is evidence but not automatically classified as a freeze. Clustering uses count/severity thresholds so that repeated 100–200+ ms events are visible as a burst.

### 4. Session checkpointing
Add an MV3 service worker `extension/background.js` and request only the `storage` permission.

Use `chrome.storage.session` because it is in-memory for the extension session and is cleared when the extension is disabled/reloaded/updated or the browser restarts. The content script does not get direct storage access; it sends bounded sanitized checkpoints to the service worker.

Checkpoint rules:
- no checkpoint from send/input/scroll hot callbacks.
- checkpoint at low frequency only while the page is quiet, or after a severe incident once the page returns to quiet.
- failure to checkpoint must never break monitoring.
- if checkpoint self-cost is abnormal, optional checkpointing is suspended while in-page passive recording continues.

On page reload, the content script may restore the most recent session checkpoint and continue the same bounded timeline. Immediate refresh during a hard freeze can still lose events that never reached a quiet checkpoint; the UI must not overclaim otherwise.

### 5. Popup controls
Add a compact `诊断黑匣子` card with three actions:
- `导出最近发送现场` — export the nearest/latest send-centered incident window.
- `导出最近10分钟` — export the bounded timeline.
- `标记刚才卡顿` — add a manual marker for non-send freezes, then allow export.

Export happens only on explicit user action using a local Blob download from the popup. No `downloads` permission is needed and no data is uploaded.

The card shows black-box state such as event count, last send marker time, latest severe cluster summary, and whether a session checkpoint is available.

### 6. Export schema
Top-level fields:
- `schemaVersion`.
- `exportedAt`.
- `pageTimeOrigin` when known.
- `conversationId` when available.
- `optimizationEnabled`.
- `captureWindow` (`send`, `manual`, or `recent`).
- `privacy` declaration.
- `summary` with counts and severe-cluster metadata.
- `events` compact sanitized event records.

No chat content fields are permitted.

## Performance budget and fail-safe behavior
- Keep a fixed event capacity and a 10-minute age window; old events are overwritten/pruned.
- No new recurring timer faster than the existing 2-second metrics update.
- Active probes remain suppressed during generating/busy/scrolling states.
- Recorder append should be trivial compared with current monitor work and is included in `selfWorkMs` where executed from `updateMetrics`.
- Checkpointing is asynchronous and quiet-state-only.
- If storage/session API is unavailable, black-box recording/export continues in page memory and reports checkpoint status as unavailable rather than failing.
- If LoAF script attribution is unavailable, retain the event with UNKNOWN script detail.

## Security and privacy constraints
- Host scope remains only `https://chatgpt.com/*`.
- No network APIs, cookies, persistent local/sync storage, IndexedDB, page `localStorage`, or page `sessionStorage`.
- Only extension `storage.session` is allowed.
- No dynamic code (`eval`, `Function`).
- No chat-body text reads.
- No automatic send/new-chat behavior.

## Testing and acceptance
Automated tests must prove:
- recorder capacity/time pruning.
- send/manual markers and send-centered slicing.
- severe-cluster detection.
- source URL/string sanitization and script-count bounds.
- hot-path source contains no forced-layout APIs and no storage/serialization calls in marker handlers.
- manifest adds only `storage` permission and MV3 service worker; host scope is unchanged.
- security tests allow only `storage.session`, never local/sync/page web storage.
- popup exposes all three black-box controls.
- full `npm test` and `npm run check` remain green.

Real-browser acceptance remains PENDING until a normalized ON/OFF run confirms the diagnostic build is not measurably worse than v1.7 and a future freeze can be exported with a useful send-centered timeline.
