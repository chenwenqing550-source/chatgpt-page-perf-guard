# Release Checklist — v1.7.1 Candidate

## Source / metadata

- [x] `extension/manifest.json` version = `1.7.1`.
- [x] `package.json` version = `1.7.1`.
- [x] Popup footer = `v1.7.1`.
- [x] Manifest permissions are exactly `storage`; no host permission expansion.
- [x] MV3 background service worker is `background.js` and content script load order places `blackbox.js` before `monitor.js`.
- [x] README / CHANGELOG label v1.7.1 as a diagnostic candidate and keep real-browser acceptance `PENDING`.
- [x] v1.7.0 remains the real-browser A/B baseline until candidate acceptance is complete.

## Static / automated verification

Fresh CI evidence for head `7f24638826fb996eceac671f05d0957ed86d9c52` before this documentation-only cleanup: run #94, 66/66 tests PASS, syntax check PASS, candidate packaging/upload PASS. Any later commit must receive a new fresh CI result before release claims.

Required gates:

- [x] Recorder is bounded and hot append does not use front `shift/splice`.
- [x] Send/scroll black-box hot path has no storage write, serialization, DOM full scan or forced-layout API.
- [x] Diagnostics add no fourth recurring monitor timer.
- [x] LoAF / LongTask / Event Timing metadata forwarding is bounded and metadata-only.
- [x] `storage.session` checkpoint is per-tab, bounded, re-sanitized and fail-suspending.
- [x] Cross-refresh restore rebases old wall-clock events into the new performance timeline and preserves chronological ordering.
- [x] Popup reads black-box status once on open, not in the 2-second polling loop.
- [x] Popup export serializes only on explicit user action and needs no downloads permission.
- [x] Security guard confirms no network telemetry, persistent extension storage, chat-text capture, cookie or dynamic-code APIs.
- [x] Handoff guard confirms no auto click/submit/KeyboardEvent/window.open.
- [x] Existing lifecycle/render guards for v1.7.0 cold-turn optimization remain passing.

## Real-browser diagnostic behavior — PENDING

Run in Chrome/Edge/Brave with the same long ChatGPT conversation used for the v1.7.0 baseline:

- [ ] Popup black-box card loads without noticeable UI lag.
- [ ] Sending with Enter creates a send marker; Shift+Enter does not create a false send marker.
- [ ] “标记刚才卡顿” works after a recovered freeze.
- [ ] “导出最近发送现场” produces a metadata-only JSON around the last send event.
- [ ] “导出最近10分钟” produces bounded history without chat text.
- [ ] During answer generation/tool-card growth, active probe remains in the expected self-yielding state.
- [ ] Long streaming output alone does not cause a new regression compared with v1.7.0.
- [ ] If a freeze occurs, record whether dragging the right page scrollbar recovers it and export evidence immediately after recovery.
- [ ] After a successful quiet checkpoint, refresh/reload restores earlier evidence; explicitly verify that events after the last checkpoint can still be absent.
- [ ] Background tab does not run nonessential layout work or session checkpoint.

## Performance A/B acceptance against v1.7.0 — PENDING

Use the same long conversation, similar viewport, similar interaction sequence and comparable output duration:

- [ ] Compare send-moment jank / clustered Forced Reflow.
- [ ] Compare generation/tool-card jank.
- [ ] Compare fast-scroll jank and scroll-anchor behavior.
- [ ] Compare extension `selfWorkMs` and whether black-box capture changes perceived responsiveness.
- [ ] Confirm no new scroll jumps, missing content or delayed viewport preheat.
- [ ] Confirm v1.7.1 does not perform measurably worse than v1.7.0 before removing Draft status.

Do **not** call the intermittent freeze fixed solely from CI. Browser acceptance requires real A/B evidence.

## Privacy / checkpoint boundary

- [ ] Exported JSON contains no chat/prompt/assistant text, DOM HTML, clipboard or network payload.
- [ ] Only `storage.session` is used; no `storage.local` / `storage.sync` fallback.
- [ ] Session data is understood as recoverable diagnostic aid, not permanent logging.
- [ ] Test refresh/reload and extension reload separately; extension reload/update may clear session diagnostics.

## Handoff

- [x] “准备换窗交接” fills the composer only.
- [x] It never sends automatically.
- [x] Prompt includes CURRENT/VERIFIED/PENDING/BLOCKED/HISTORICAL/REJECTED.
- [x] Prompt protects repo/branch/exact SHA/version/test result/next step/Stop Rule.
- [x] Handoff is described as new-window transfer, not server-side context compression.

## Release surface

- [ ] Keep PR #5 Draft while browser A/B is PENDING.
- [ ] Attach/use the CI `chatgpt-page-perf-guard-v1.7.1-candidate` artifact for browser testing.
- [ ] Update Issue #4 with each real freeze export and A/B conclusion.
- [ ] Merge to `main` only after normalized browser evidence confirms no regression.
- [ ] Never delete Git history needed for audit/recovery.
