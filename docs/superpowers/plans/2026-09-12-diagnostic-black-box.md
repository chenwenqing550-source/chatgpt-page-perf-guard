# Diagnostic Black Box v1.7.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only, low-overhead diagnostic black box that captures send-centered performance incident timelines and exports them without degrading v1.7 runtime behavior.

**Architecture:** Add a pure bounded recorder module used by the existing content monitor, plus a minimal MV3 service worker for quiet-state `storage.session` checkpoints. Reuse current passive performance observers and metrics cadence; do not add high-frequency probes or synchronous layout reads. Popup actions request already-recorded data and export JSON only on explicit user action.

**Tech Stack:** Manifest V3 extension JavaScript, Node.js 20 built-in test runner, Chrome/Edge `PerformanceObserver`, `chrome.runtime`, `chrome.storage.session`.

**Spec:** `docs/superpowers/specs/2026-09-12-diagnostic-black-box-design.md`

## Global Constraints

- Diagnostics only in this candidate; do not change cold-turn optimization behavior or tuning thresholds.
- Host scope remains `https://chatgpt.com/*` only.
- Add only the `storage` extension permission; no network, cookie, downloads, tabs, scripting, or persistent-storage permissions.
- No chat text, DOM HTML, prompt content, assistant content, clipboard content, or cookie data in diagnostics.
- No new recurring timer faster than the existing 2-second metrics update.
- Send/input/scroll hot callbacks must not serialize, write storage, scan the DOM, or read forced-layout properties.
- Session checkpoint failure must degrade to in-page memory recording without breaking monitoring.
- Real-browser acceptance remains PENDING after automated tests until normalized A/B evidence is collected.

---

### Task 1: Bounded recorder and incident slicing

**Files:**
- Create: `extension/blackbox.js`
- Create: `tests/blackbox.test.js`
- Modify: `extension/manifest.json`

**Interfaces:**
- Produces global `CGPTPerfBlackBox` with `createRecorder(options)`.
- Recorder methods: `record(event)`, `mark(kind, details)`, `hydrate(events)`, `events()`, `latestMarker(kinds)`, `findSevereClusters()`, `exportRecent(nowWallMs)`, `exportAroundLatestMarker(kinds, beforeMs, afterMs)`.
- `sanitizeSourceUrl(url)` strips query/fragment and bounds string size.
- `sanitizeLoafEntry(entry, context)` bounds script summaries to 8.

- [ ] **Step 1: Write failing recorder tests**

Add tests proving fixed-capacity pruning, 10-minute age pruning, wall/perf timestamps, source URL sanitization, maximum 8 script summaries, severe-cluster detection, and send-centered slicing.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/blackbox.test.js`
Expected: FAIL because `extension/blackbox.js` does not exist / recorder API is missing.

- [ ] **Step 3: Implement the minimal recorder**

Implement an IIFE attaching the pure API to `globalThis.CGPTPerfBlackBox`. Use array/ring semantics with bounded capacity and age pruning. Do not touch the DOM or extension APIs.

- [ ] **Step 4: Add `blackbox.js` before `monitor.js` in the content-script order**

Do not add permissions in this task beyond what Task 3 will require; only load order changes here.

- [ ] **Step 5: Run focused and existing load-shedding tests**

Run: `node --test tests/blackbox.test.js tests/monitor-load-shedding.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add bounded diagnostic recorder`

---

### Task 2: Integrate send-time and passive performance evidence

**Files:**
- Modify: `extension/monitor.js`
- Create: `tests/monitor-blackbox.test.js`
- Modify: `tests/monitor-load-shedding.test.js`

**Interfaces:**
- `monitor.js` consumes `CGPTPerfBlackBox.createRecorder()`.
- New runtime messages: `getBlackBoxStatus`, `markBlackBoxJank`, `getBlackBoxExport`.
- Export modes accepted by `getBlackBoxExport`: `send`, `manual`, `recent`.
- Checkpoint producer function returns a sanitized bounded object but does not itself access storage.

- [ ] **Step 1: Write failing monitor integration tests**

Tests must assert:
- `CGPTPerfBlackBox` is required before monitor setup.
- send markers are recorded from `submit` and unmodified Enter key handling without reading input text.
- scroll marker records time/position only.
- LoAF sanitization records browser-provided forced-style/layout timing.
- marker handlers contain no `JSON.stringify`, storage calls, `getBoundingClientRect`, `scrollHeight`, `offset*`, `client*`, or computed-style reads.
- no new recurring timer faster than 2 seconds.
- runtime messages for status/mark/export exist.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/monitor-blackbox.test.js tests/monitor-load-shedding.test.js`
Expected: FAIL because black-box monitor integration is absent.

- [ ] **Step 3: Add recorder integration**

Create one recorder with a 10-minute window and bounded capacity. Reuse existing LoAF/LongTask, Event Timing, mutation, activity, and 2-second metrics code. Record compact sample events from `updateMetrics`.

- [ ] **Step 4: Add send/manual/scroll markers without hot-path side effects**

`submit` and Enter only append a marker and update existing interaction timestamps. `scroll` appends a bounded marker with `scrollY` if finite. No storage/serialization/layout scanning in these callbacks.

- [ ] **Step 5: Add status/export message handlers**

Return copies only when popup explicitly requests data. Build export payload only inside `getBlackBoxExport`, never during normal streaming.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/blackbox.test.js tests/monitor-blackbox.test.js tests/monitor-load-shedding.test.js tests/monitor-lifecycle.test.js tests/monitor-compat.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: capture send-centered performance incidents`

---

### Task 3: Quiet-state session checkpoint service worker

**Files:**
- Create: `extension/background.js`
- Modify: `extension/manifest.json`
- Modify: `extension/monitor.js`
- Create: `tests/blackbox-session.test.js`
- Modify: `tests/security.test.js`
- Modify: `package.json`

**Interfaces:**
- Background messages: `blackBoxCheckpoint`, `blackBoxRestore`, `blackBoxClear`.
- Session key format: `blackbox-tab-<tabId>`.
- Monitor schedules checkpoint attempts only from the existing 2-second update path when activity is `quiet`, at least 30 seconds since the previous successful checkpoint, or when a severe incident is pending and the page has returned to quiet.

- [ ] **Step 1: Write failing session/security tests**

Assert:
- manifest permissions are exactly `["storage"]`.
- MV3 background service worker is `background.js`.
- background uses only `storage.session`, never `local` or `sync`.
- source remains free of network/cookie/page-web-storage/dynamic-code APIs.
- monitor contains no direct storage access.
- checkpoint cadence is quiet-state gated and not performed in send/scroll handlers.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/blackbox-session.test.js tests/security.test.js`
Expected: FAIL because service worker/session checkpointing is absent and current security test forbids all storage.

- [ ] **Step 3: Implement minimal background session storage**

Validate message shape, derive tab ID from `sender.tab.id` for content-script checkpoints, store bounded sanitized snapshots under a per-tab key, and return stored data to restore requests. Catch/reply on API failures.

- [ ] **Step 4: Add quiet checkpoint/restore in monitor**

At startup, asynchronously request restore and hydrate the recorder. During `updateMetrics`, when quiet and due, send a bounded checkpoint. Track checkpoint state and suspend optional checkpoint attempts temporarily after failures or excessive measured dispatch cost.

- [ ] **Step 5: Update `package.json` check script**

Include syntax checks for `blackbox.js` and `background.js`.

- [ ] **Step 6: Run focused security/session tests**

Run: `node --test tests/blackbox-session.test.js tests/security.test.js tests/monitor-blackbox.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: preserve diagnostics in session memory`

---

### Task 4: Popup status, one-click export, and manual mark

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Create: `tests/popup-blackbox.test.js`
- Modify: `tests/popup-compat.test.js`
- Modify: `tests/release.test.js`

**Interfaces:**
- Popup element IDs: `blackBoxState`, `blackBoxSummary`, `exportSendButton`, `exportRecentButton`, `markJankButton`, `blackBoxStatus`.
- Popup calls content-script messages defined in Task 2.
- Export filename format: `chatgpt-perf-blackbox-<mode>-<epoch>.json`.

- [ ] **Step 1: Write failing popup tests**

Assert all three controls exist, the popup requests status, mark and export messages, Blob JSON creation occurs only inside an explicit export action, and no automatic download happens during refresh polling.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/popup-blackbox.test.js tests/popup-compat.test.js`
Expected: FAIL because UI/actions do not exist.

- [ ] **Step 3: Add the diagnostic card**

Reuse existing button/card styles. Show event count, latest send marker, severe-cluster summary, and session-checkpoint status.

- [ ] **Step 4: Add explicit local export and manual marker actions**

On export click, request payload, create Blob/object URL, click a temporary anchor, and revoke the URL. On manual mark click, request `markBlackBoxJank` and refresh status. Do not add `downloads` permission.

- [ ] **Step 5: Run popup/release tests**

Run: `node --test tests/popup-blackbox.test.js tests/popup-compat.test.js tests/release.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add one-click diagnostic exports`

---

### Task 5: Full regression, documentation, and candidate gate

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: PR #3 / Issue #4 notes through GitHub comments only; do not merge.

**Interfaces:**
- User-facing docs describe session-memory behavior honestly: survives page refresh only after a successful quiet checkpoint; extension/browser restart clears the session store.

- [ ] **Step 1: Run full automated validation**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run check`
Expected: PASS with no syntax errors.

- [ ] **Step 2: Review diff for performance regressions**

Verify no hot callback does storage/serialization/full-DOM scan/forced-layout reads and no new sub-2-second recurring timer exists.

- [ ] **Step 3: Update README and CHANGELOG**

Document privacy boundary, three popup actions, checkpoint limitations, and browser A/B requirement.

- [ ] **Step 4: Re-run full validation after docs/release changes**

Run: `npm test && npm run check`
Expected: PASS.

- [ ] **Step 5: Update Issue #4 and Draft PR #3 with evidence**

Record exact test counts/CI status and keep real-browser acceptance PENDING until the user validates v1.7.1 against v1.7.

- [ ] **Step 6: Commit**

Commit message: `docs: document v1.7.1 diagnostic candidate`
