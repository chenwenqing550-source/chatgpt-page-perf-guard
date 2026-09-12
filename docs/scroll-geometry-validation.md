# Scroll geometry regression — v1.7.2 candidate

## Scope and source

Base: `fc0e599241ce3c6768afac2900597b60c74c2a12` (v1.7.1 diagnostic candidate).
All 11 runtime files used as the local baseline were matched to that commit's Git blob IDs. Local Git transport was unavailable; this was a scoped runtime mirror, not an exact full repository checkout. No private conversation text, video, or user diagnostics are included in the repository.

## Reproduced defect

The old stylesheet supplies `auto 720px` / `auto 640px` only when a turn is already offscreen. `auto` does not guarantee a remembered natural height before containment has been active while the element renders. Initial cooling therefore changes the page's scroll range. The intersection callback then removes the marker near the viewport, discarding containment and forcing content to expand again while scrolling. Quiet-gating the periodic maintainer does not gate these observer writes.

A native Chromium fixture used 25 articles with 25 + 4*i paragraphs, each paragraph 24px high, 12px article padding and 1px bottom border. A 700px-high nested scroll container started at the bottom. The original monitor and stylesheet ran with only WebExtension messaging stubbed; DOM, rendering, observers and timers were real. Sampled after 22.5 seconds, then scrolled to 4000px and sampled after 500ms.

| Measurement | v1.7.1 baseline | v1.7.2 candidate |
|---|---:|---:|
| Initial scrollHeight | 44425 | 44425 |
| After cooling | 22897 | 44425 |
| After scroll | 24697 | 44425 |
| Cold markers after cooling | 23 | 23 |
| Cold markers after scroll | 20 | 23 |

This is deterministic geometry evidence, not a wall-clock speedup or proof about the user's installed version. A screen recording shows symptoms, not a JavaScript stack or exclusive causal attribution.

## Repair and focused checks

Use natural content-box measurements from ResizeObserver before cooling. Cache only warm measurements; do not learn a skipped placeholder as natural height. Seed only intrinsic block size, retaining inline layout. Intersection observations update in-memory proximity only; content-visibility:auto handles relevant rendering. A width change invalidates cached wrapping and is processed on the quiet path. Recent/modified turns and disabling remain protected; disconnected nodes are unobserved.

`node --test tests/scroll-geometry.test.js`: original baseline 4 pass / 8 fail; repaired candidate 12 pass / 0 fail. The harness tests production logic with explicit browser observations, no forced-layout getters. It does not simulate rendering; the Chromium fixture above covers that separate boundary. Syntax checks were also run locally. Full repository tests are separately run by candidate CI, not inferred from this subset.

## Open acceptance and known limits

- Real Windows / Edge / current ChatGPT A/B is PENDING. Verify installed version, browser version, same conversation and comparable machine load.
- Cover drag-scroll in both directions, large jumps, text selection/copy, send/stream/tool cards, viewport resizing/zoom, optimization disable/re-enable and unsupported APIs.
- Check long-frame and input latency distributions as well as scrollHeight/anchor drift. selfWorkMs excludes browser rendering and is not a total cost measurement.
- ChatGPT rerenders, browser compositor/GPU, other extensions and recording overhead remain possible contributors; this patch does not remove server-side or page-bundle work.
- Mutation inspection remains bounded to the existing first 12 records; more complex DOM replacement, margin-collapse / layout variants and font-driven changes need representative live-page validation. Do not claim all markup variants are covered.
- Keep the black box and inherited v1.7.0 ↔ v1.7.1 diagnostic-overhead acceptance debt. Remove diagnostic capture only after the live root-cause and regression gates justify it under the user's conditional authorization.
- Do not merge main or publish a stable release merely because these focused checks pass.

References: CSS Containment and ResizeObserver browser behavior; MDN content-visibility; Chrome DevTools forced-reflow guidance. These explain the mechanism, not the user's specific runtime trace.
