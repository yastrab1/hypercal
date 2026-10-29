# Calendar performance, 2026-10-29

Compared with **v0.8.1**, the standard day/week/month navigation benchmark uses **52.4% less rendering time on desktop** and **55.0% less in the phone layout**, using the equal-weight geometric mean of those three workload ratios. Individual day/week gains are smaller than 50%; month and continuous views provide the largest improvements.

| Workload          | Desktop before → after | Phone layout before → after |
| ----------------- | ---------------------: | --------------------------: |
| Day navigation    |          10.2 → 8.9 ms |                9.0 → 7.3 ms |
| Month navigation  |         82.9 → 15.4 ms |              91.7 → 15.4 ms |
| Week navigation   |         39.3 → 26.1 ms |              34.3 → 23.0 ms |
| Continuous month  |        1009.6 → 4.8 ms |              915.0 → 5.0 ms |
| Continuous week   |          64.0 → 6.7 ms |               57.3 → 6.6 ms |
| Year event update |        4606.6 → 8.5 ms |             4885.6 → 6.5 ms |

Across all six workloads, the equal-weight geometric mean reduction is 93.2% on desktop and 93.5% in the phone layout. This is a synchronous rendering/DOM/layout measurement, **not an FPS, network-latency, or whole-app speed claim**. The phone result uses a 390×844 viewport in the same desktop Chromium engine; no physical Android device was attached. Native Android performance must be checked on a device before claiming these percentages there.

## What changed

- A date index parses immutable event objects once, queries overlapping intervals, and builds day/week models on demand. It respects exclusive end dates, overnight events, DST, and timezone changes.
- Unchanged month rows, year months, and time columns retain their models and React subtrees. Standard period navigation reuses hour-slot elements. Callback delegation keeps event actions current.
- Fixed-size offscreen continuous rows and columns use content visibility. One background per day draws hour/half-hour grid lines instead of hundreds of pseudo-elements.
- Unchanged provider refreshes preserve event references and can preserve the entire event array. Shared calendar metadata is reused when unchanged.
- Device cache reads reuse decoded JSON while still checking the current storage value and expiry. The memory cache is bounded and cleared on sign-out; the disk format and account isolation remain unchanged.
- The backend shares concurrent identical Google reads within an account. Responses are not retained after completion, so subsequent refreshes still reach Google.

The separate cache test performs 100 range reads against 6,000 cached events in an in-memory Storage adapter: median JSON/cache processing fell from 558.4 ms to 0.5 ms. This isolates decoding work and excludes actual disk I/O.

## Method

The benchmark uses **production React**, with 6,000 deterministic synthetic events over one year and 12 calendars. Normal navigation receives the period's event range with fresh provider-shaped objects. Continuous views use 18 week rows or 21 day columns and incremental batches. Year updates replace one event object. There are no accounts or provider requests in the fixture.

Each sample measures `flushSync(root.render(...))` plus a forced layout. Normal cases use three warm-up iterations and 12 samples; year updates use one warm-up and five samples. The table shows medians. Desktop is 1280×900; phone layout is 390×844. Both builds use the same host, viewport, fixture, dependency versions, and benchmark code. Samples and exact calculations are saved in [the JSON report](performance/2026-10-29.json).

## Reproduce

```sh
npm ci
npm run perf:baseline   # snapshots v0.8.1 source and builds the baseline
npm run perf:build      # builds the working tree
npm run perf:serve      # loopback-only fixture server on port 5174
```

Open these pages and press **Run benchmark** at each viewport size:

- http://localhost:5174/baseline/scripts/performance/index.html
- http://localhost:5174/current/scripts/performance/index.html

Save each page's JSON output as `artifacts/performance/{baseline,current}-{desktop,phone}.json`. Then run:

```sh
npm run perf:cache > artifacts/performance/cache.json
npm run perf:report
```

Fixtures are development tools and are excluded from the normal web/APK build. Automated regression tests cover indexed overlap/ribbon equivalence, midnight ends, DST, timezone changes, cache eviction/isolation, unchanged/changed provider records, and concurrent-read isolation/retry. Browser checks cover event details/editing, scrolling, date popovers, keyboard hour navigation, and desktop/phone layouts.
