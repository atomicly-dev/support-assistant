// Runs one milestone's checks, or all of them: `npm run milestone -- 3`, `npm run milestone -- all`.
// Each milestone's tests run in their own Node process, with the reporter in scripts/reporter.mjs.
// It exits with 0 when every check it ran passes, and 1 when any fails.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const milestones = JSON.parse(readFileSync(new URL("../milestones.json", import.meta.url), "utf8"));
const reporter = fileURLToPath(new URL("reporter.mjs", import.meta.url));

const arg = process.argv[2];
const chosen = arg === "all" ? milestones : milestones.filter((m) => String(m.n) === arg);
if (chosen.length === 0) {
  console.error(`Pick a milestone from 1 to ${milestones.length}, or all: npm run milestone -- 1`);
  process.exit(2);
}

const failed = [];
for (const milestone of chosen) {
  console.log(`\nMilestone ${milestone.n}: ${milestone.title}\n`);
  const { status } = spawnSync(
    process.execPath,
    ["--test", `--test-reporter=${reporter}`, "--test-timeout=10000", `tests/m${milestone.n}.test.mjs`],
    { cwd: root, stdio: "inherit", env: { ...process.env, MILESTONE: String(milestone.n) } },
  );
  if (status !== 0) failed.push(milestone.n);
}

if (chosen.length > 1) {
  const passed = chosen.filter((m) => !failed.includes(m.n)).map((m) => m.n);
  console.log(`\nPassed: ${passed.join(", ") || "none"}. Not passed yet: ${failed.join(", ") || "none"}.`);
}
process.exit(failed.length > 0 ? 1 : 0);
