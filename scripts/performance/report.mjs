import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const read = (name) =>
  JSON.parse(readFileSync(`artifacts/performance/${name}.json`, "utf8"));
const report = {
  baseline: "v0.8.1",
  current: "v0.9.0",
  date: "2026-10-29",
  method:
    "Production React; 6,000 synthetic yearly events; period-specific ranges; median synchronous rendering + DOM commit + forced layout. Equal-weight geometric mean across six workloads. Viewport sizes do not emulate Android hardware.",
  platforms: [],
  cache: read("cache"),
};
for (const platform of ["desktop", "phone"]) {
  const baseline = read(`baseline-${platform}`),
    current = read(`current-${platform}`);
  const cases = baseline.cases.map((old, i) => ({
    name: old.name,
    beforeMs: old.medianMs,
    afterMs: current.cases[i].medianMs,
    reduction: 1 - current.cases[i].medianMs / old.medianMs,
  }));
  const reduction =
    1 -
    Math.exp(
      cases.reduce((n, c) => n + Math.log(c.afterMs / c.beforeMs), 0) /
        cases.length,
    );
  const standard = cases.filter((c) =>
    ["day", "month", "week"].includes(c.name),
  );
  const standardReduction =
    1 -
    Math.exp(
      standard.reduce((n, c) => n + Math.log(c.afterMs / c.beforeMs), 0) /
        standard.length,
    );
  report.platforms.push({
    standardReduction,
    platform,
    viewport: current.viewport,
    reduction,
    cases,
    baselineSamples: baseline,
    currentSamples: current,
  });
}
mkdirSync("docs/performance", { recursive: true });
writeFileSync(
  "docs/performance/2026-10-29.json",
  JSON.stringify(report, null, 2) + "\n",
);
for (const p of report.platforms) {
  console.log(
    `${p.platform}: ${(p.reduction * 100).toFixed(1)}% lower render cost`,
  );
  for (const c of p.cases)
    console.log(
      `  ${c.name}: ${c.beforeMs.toFixed(1)} → ${c.afterMs.toFixed(1)} ms (${(c.reduction * 100).toFixed(1)}%)`,
    );
}

for (const p of report.platforms)
  console.log(
    `${p.platform} standard day/week/month: ${(p.standardReduction * 100).toFixed(1)}% lower render cost`,
  );
