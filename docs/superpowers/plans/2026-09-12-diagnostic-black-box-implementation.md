# Diagnostic Black Box v1.7.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a low-overhead, local-only diagnostic black box that preserves send-time performance incident timelines and supports one-click export without making the v1.7 runtime hot path heavier in ways that can trigger layout work.

**Architecture:** Add a pure `blackbox.js` recorder loaded before `monitor.js`; reuse existing passive observers and two-second sampling, add O(1) send/manual/scroll markers, and keep all hot-path recording in memory. Add an MV3 service worker that owns `storage.session` checkpoints, and a compact popup UI that requests exports explicitly from the content script. Existing optimization logic stays unchanged in this candidate.

**Tech Stack:** Manifest V3 browser extension, plain JavaScript, Node.js `node:test`, `chrome.storage.session` / compatible `browser.storage.session`.

**Spec:** `docs/superpowers/specs/2026-09-12-diagnostic-black-box-design.md`

## Global Constraints

- Do not change cold-turn optimization thresholds or recommendation policy in this candidate.
- Host scope remains only `https://chatgpt.com/*`.
- Add only the `storage` extension permission; no downloads/network/cookies permissions.
- Hot-path send/input/scroll/PerformanceObserver callbacks must not serialize, write storage, scan the DOM, or read forced-layout APIs.
- Never capture chat text, prompt text, assistant text, DOM HTML, clipboard data, cookies, or network payloads.
- Recorder capacity and time horizon are fixed and bounded; oldest entries are discarded.
- Real-browser performance acceptance remains PENDING until normalized v1.7 vs v1.7.1 testing.

---

### Task 1: Pure bounded black-box recorder

**Files:**
- Create: `extension/blackbox.js`
- Create: `tests/blackbox.test.js`
- Modify: `extension/manifest.json`
- Modify: `package.json`

**Interfaces:**
- Produces global `CGPTPerfBlackBox` with `createRecorder(options)`, `sanitizeString(value, maxLength)`, `sanitizeSourceUrl(value)`, and `summarizeLoafScripts(scripts)`.
- Recorder produces `record(kind, data, timestamps)`, `markSend(source, timestamps)`, `markManual(timestamps)`, `snapshot(nowPerf)`, `sliceAroundMarker(markerKind, beforeMs, afterMs, nowPerf)`, `detectSevereClusters(nowPerf)`, `buildExport(kind, context)`.

- [ ] **Step 1: Write failing recorder tests**

Create tests proving fixed capacity, 10-minute pruning, send/manual marker slicing, severe-cluster grouping, source URL sanitization, bounded script count, and absence of chat-text fields.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/blackbox.test.js`
Expected: FAIL because `extension/blackbox.js` does not exist.

- [ ] **Step 3: Implement minimal pure recorder**

Use an array/ring implementation with constant-bounded memory, no DOM access, no browser API calls, and no timers. Normalize records to compact primitives and cap strings/scripts.

- [ ] **Step 4: Load recorder before monitor and include it in syntax checks**

Add `blackbox.js` before `monitor.js` in manifest content scripts and add `node --check extension/blackbox.js` to `npm run check`.

- [ ] **Step 5: Run focused tests and syntax check**

Run: `node --test tests/blackbox.test.js && npm run check`
Expected: PASS.

---

### Task 2: Integrate passive evidence and send-time markers without layout reads

**Files:**
- Modify: `extension/monitor.js`
- Modify: `tests/monitor-load-shedding.test.js`
- Create: `tests/blackbox-hotpath.test.js`

**Interfaces:**
- Consumes `CGPTPerfBlackBox.createRecorder()`.
- `monitor.js` exposes runtime messages `getBlackBoxStatus`, `markBlackBoxIncident`, `exportBlackBox`.
- Export kinds: `send`, `manual`, `recent`.

- [ ] **Step 1: Write failing integration/static hot-path tests**

Tests require: send markers from `submit` and Enter key, scroll markers, LoAF metadata forwarding, two-second sample forwarding, and runtime message handlers. Static tests reject `getBoundingClientRect`, `offsetHeight/Width/Top/Left`, `clientHeight/Width`, `scrollHeight`, `getComputedStyle`, `JSON.stringify`, or storage calls inside marker callbacks.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/monitor-load-shedding.test.js tests/blackbox-hotpath.test.js`
Expected: FAIL for missing black-box integration.

- [ ] **Step 3: Implement minimal monitor integration**

Create one recorder instance. In existing PerformanceObserver callbacks, record browser-provided LoAF/LongTask metadata and bounded scripts. In the existing interaction listeners, detect submit and Enter without reading input text. Record scroll with `scrollX/scrollY` only. Record compact samples from `updateMetrics()` after existing calculations.

- [ ] **Step 4: Add export/status runtime messages**

`getBlackBoxStatus` returns counts/last-marker/cluster summary only. `markBlackBoxIncident` adds a manual marker. `exportBlackBox` returns a sanitized object; it does not stringify it.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/monitor-load-shedding.test.js tests/blackbox-hotpath.test.js`
Expected: PASS.

---

### Task 3: Quiet-state session checkpoint service worker

**Files:**
- Create: `extension/background.js`
- Modify: `extension/manifest.json`
- Modify: `extension/monitor.js`
- Create: `tests/session-checkpoint.test.js`
- Modify: `tests/security.test.js`

**Interfaces:**
- Background messages: `saveBlackBoxCheckpoint`, `loadBlackBoxCheckpoint`, `clearBlackBoxCheckpoint`.
- Checkpoint key is scoped by conversation ID when available, otherwise a tab/session-safe fallback key supplied by the content script.

- [ ] **Step 1: Write failing checkpoint/security tests**

Require exactly `permissions: ["storage"]`, MV3 service worker `background.js`, `storage.session` only, no `storage.local`/`storage.sync`, no network APIs, and no direct content-script storage use.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/session-checkpoint.test.js tests/security.test.js`
Expected: FAIL because background/checkpoint support does not exist and old least-privilege assertion expects zero permissions.

- [ ] **Step 3: Implement service worker session storage wrapper**

Use `browser || chrome`; respond gracefully when session storage is unavailable. Store only sanitized bounded checkpoint objects.

- [ ] **Step 4: Add quiet-state checkpoint scheduling to existing 2-second update path**

Do not add a faster recurring timer. Only request checkpoint when state is `quiet`, enough time has elapsed since the previous checkpoint, and recorder content changed. Never checkpoint from send/scroll/observer callbacks. On startup, asynchronously request restore and merge bounded compatible events.

- [ ] **Step 5: Add checkpoint fail-safe**

Measure request initiation/handling bookkeeping; if repeated checkpoint attempts exceed the configured self-cost/failure threshold, suspend optional checkpointing while leaving in-page recording active.

- [ ] **Step 6: Run checkpoint/security tests**

Run: `node --test tests/session-checkpoint.test.js tests/security.test.js`
Expected: PASS.

---

### Task 4: Popup status, manual marker, and one-click local JSON export

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/popup.css`
- Modify: `tests/popup-compat.test.js`
- Create: `tests/popup-blackbox.test.js`

**Interfaces:**
- Buttons: `exportSendIncidentButton`, `exportRecentBlackBoxButton`, `markIncidentButton`.
- Status element: `blackBoxStatus`.

- [ ] **Step 1: Write failing popup tests**

Require the three controls, status rendering, explicit user-click export, local Blob/object URL creation, and no `downloads` permission/API.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/popup-compat.test.js tests/popup-blackbox.test.js`
Expected: FAIL for missing controls/handlers.

- [ ] **Step 3: Add compact diagnostic card**

Show event count, latest send marker age, severe-cluster summary, and checkpoint state. Keep card visually consistent with existing popup.

- [ ] **Step 4: Add export/marker actions**

On export click, request a sanitized object from content script, stringify only in popup, create a Blob, trigger a local anchor download, and revoke the object URL. On manual mark, send `markBlackBoxIncident`, then refresh status.

- [ ] **Step 5: Run popup tests**

Run: `node --test tests/popup-compat.test.js tests/popup-blackbox.test.js`
Expected: PASS.

---

### Task 5: Versioning, regression gates, and issue evidence

**Files:**
- Modify: `extension/manifest.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `tests/release.test.js`
- Modify: `tests/security.test.js`
- Modify: `tests/monitor-compat.test.js`

**Interfaces:**
- Candidate version becomes `1.7.1`.
- Documentation explicitly labels real-browser performance acceptance as PENDING.

- [ ] **Step 1: Write/update release regression assertions**

Require version alignment, black-box files loaded, only `storage` permission, no host-scope expansion, no network APIs, no persistent storage, no chat-body reads, and no auto-send/new-chat behavior.

- [ ] **Step 2: Run all tests before version/docs changes**

Run: `npm test`
Expected: any remaining failures identify incomplete candidate work; do not mask them with assertion weakening.

- [ ] **Step 3: Update version and docs**

Document privacy boundaries, export controls, session-only checkpoint semantics, known limitation that a hard freeze followed by immediate reload can lose uncheckpointed events, and the requirement for normalized browser A/B against v1.7.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run check`
Expected: all tests PASS and syntax check PASS.

- [ ] **Step 5: Independent diff review before completion claim**

Review changed files for accidental optimization changes, unbounded buffers, hot-path storage/serialization/layout reads, permission expansion, or captured text fields. Any issue found is fixed with a new failing regression test first.

- [ ] **Step 6: Record candidate status in Issue #4**

Post exact commit SHA, automated test counts, known limitations, and browser acceptance = PENDING. Do not claim the freeze is fixed until real-browser evidence supports it.
