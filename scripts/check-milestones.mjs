// For the template's maintainers: checks that milestones.json matches the repo, since atomicly
// imports it. Each milestone needs its doc, its files, and its test file, and its "checks" must be
// that file's test names, in order. `.github/workflows/template-ci.yml` runs it.

import { existsSync, readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const milestones = JSON.parse(readFileSync(new URL("milestones.json", root), "utf8"));
const problems = [];

milestones.forEach((m, i) => {
  const where = `milestone ${m.n}`;
  if (m.n !== i + 1) problems.push(`${where}: n should be ${i + 1}`);
  for (const key of ["slug", "title", "goal"]) if (typeof m[key] !== "string" || !m[key]) problems.push(`${where}: no ${key}`);
  if (!existsSync(new URL(`milestones/${m.n}-${m.slug}.md`, root))) problems.push(`${where}: no milestones/${m.n}-${m.slug}.md`);
  if (!m.lessons?.length || m.lessons.some((id) => !/^ai-[a-z0-9-]+$/.test(id))) problems.push(`${where}: lessons should be ai- lesson ids`);
  for (const file of m.files ?? []) if (!existsSync(new URL(file, root))) problems.push(`${where}: no file ${file}`);
  if (!m.files?.length) problems.push(`${where}: no files`);
  const testFile = new URL(`tests/m${m.n}.test.mjs`, root);
  if (!existsSync(testFile)) return problems.push(`${where}: no tests/m${m.n}.test.mjs`);
  const names = [...readFileSync(testFile, "utf8").matchAll(/^test\("([^"]+)"/gm)].map((match) => match[1]);
  if (JSON.stringify(names) !== JSON.stringify(m.checks)) {
    problems.push(`${where}: "checks" should be the test names, in order:\n${JSON.stringify(names, null, 2)}`);
  }
});

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`milestones.json matches the repo: ${milestones.length} milestones, ${milestones.reduce((n, m) => n + m.checks.length, 0)} checks.`);
