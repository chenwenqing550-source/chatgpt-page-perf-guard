# Release Checklist — v1.7.0

## Source / metadata

- [ ] `extension/manifest.json` version = `1.7.0`.
- [ ] `package.json` version = `1.7.0`.
- [ ] Popup footer = `v1.7.0`.
- [ ] README current install guidance only points to v1.7.0.
- [ ] v1.6.x appears only in historical changelog/release history, not as recommended baseline.

## Static / automated verification

- [ ] `npm test` PASS.
- [ ] `npm run check` PASS.
- [ ] Security guard confirms no network, persistent storage, cookie or dynamic-code APIs.
- [ ] Handoff guard confirms no auto click/submit/KeyboardEvent/window.open.
- [ ] Lifecycle tests cover background, scrolling, generating, busy, interaction guard and bounded ring buffer.
- [ ] Render guard confirms only explicit cold turns receive `content-visibility`.

## Browser behavior

Run in Chrome/Edge with a long ChatGPT conversation:

- [ ] Send a message while the page is already long: extension enters protection/busy state immediately.
- [ ] During answer generation and tool-card growth: active probe shows “已让路”.
- [ ] Generate while rapidly scrolling: no bulk coverage/layout scan is triggered.
- [ ] Last two turns and currently growing turn never receive cold optimization.
- [ ] A far historical turn only becomes cold after it is confirmed outside the preheat area and stable.
- [ ] Returning near viewport preheats/removes cold state before the content reaches the visible region.
- [ ] Background tab stops nonessential active work.
- [ ] Recent incident/self-work diagnostics contain numbers/status only, no chat body.

## A/B acceptance against previous public build

Use the same long conversation and similar interaction sequence:

- [ ] Compare “send moment” jank.
- [ ] Compare generation/tool-card jank.
- [ ] Compare fast-scroll jank.
- [ ] Compare whether refresh is still required to restore smoothness.
- [ ] Confirm v1.7.0 does not introduce scroll jumps or missing content.

Do not call the performance change proven until real-browser A/B evidence exists.

## Handoff

- [ ] “准备换窗交接” fills the composer only.
- [ ] It never sends automatically.
- [ ] Prompt includes CURRENT/VERIFIED/PENDING/BLOCKED/HISTORICAL/REJECTED.
- [ ] Prompt protects repo/branch/exact SHA/version/test result/next step/Stop Rule.
- [ ] Handoff is described as new-window transfer, not server-side context compression.

## Release surface

- [ ] Merge verified candidate to `main`.
- [ ] Publish v1.7.0 package/release.
- [ ] Only after v1.7.0 is available, mark/remove v1.6.1 public release from the recommended surface.
- [ ] Never delete Git history needed for audit/recovery.
