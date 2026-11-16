// Checks the Infrastructure Optimization template before a push, with the very code the workflow runs.
//   npm run test:infra                        check the template, the saved query results and the number check
//   npm run test:infra -- --live <context>    run every query with dtctl first, save the results, then check
//                                             (--name <set> names the saved set; default: the tenant id)
// What it checks:
// 1. infraOptimizationQueries.ts matches infra-queries/*.dql (scripts/gen-infra-queries.mjs).
// 2. The workflow builds: prompt and instruction lengths, task positions (they throw when wrong).
// 3. Every saved result set (infra-tests/fixtures/<set>/<query>.json) passes checkData - the query
//    results agree with each other - and renders in both languages without undefined/NaN.
// 4. Each synthetic set (infra-tests/synthetic/*.json) raises exactly the issues it expects - the
//    checks themselves still catch what they were written for.
// 5. The number check flags what infra-tests/number-check.json expects - past AI mistakes.
// Saved results are tenant data and stay out of git (.gitignore); the synthetic sets are committed.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generate, QUERY_NAMES, readQuery } from "./gen-infra-queries.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, "tmp", "infra-check");
const fixtures = join(root, "infra-tests", "fixtures");
mkdirSync(work, { recursive: true });

let failures = 0;
const fail = (message) => {
  failures++;
  console.error("  FAIL " + message);
};
const ok = (message) => console.log("  ok   " + message);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

// 0. --live: run the queries and save the results.
const context = argument("--live");
if (context) {
  console.log(`Running the queries with dtctl --context ${context}`);
  let set = argument("--name");
  if (!set) {
    // A plain array with -o json; { ok, result } without it.
    const listed = JSON.parse(execFileSync("dtctl", ["config", "get-contexts", "-o", "json"], { encoding: "utf8" }));
    const contexts = Array.isArray(listed) ? listed : (listed.result ?? []);
    const environment = contexts.find((entry) => entry.Name === context)?.Environment ?? context;
    set = environment.replace(/^https?:\/\//, "").split(".")[0];
  }
  const target = join(fixtures, set);
  mkdirSync(target, { recursive: true });
  for (const name of QUERY_NAMES) {
    const file = join(work, `${name}.dql`);
    writeFileSync(file, readQuery(name));
    try {
      const output = execFileSync("dtctl", ["--context", context, "query", "-f", file, "-o", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      const records = JSON.parse(output).records ?? [];
      writeFileSync(join(target, `${name}.json`), JSON.stringify(records, null, 1));
      ok(`${name}: ${records.length} records`);
    } catch (error) {
      // A query that fails (network without the extension) is QUERY_FAILED in the workflow: no file.
      console.log(`  --   ${name}: failed (${String(error.stderr ?? error.message).split("\n")[0].slice(0, 120)})`);
    }
  }
  console.log(`Saved as infra-tests/fixtures/${set}`);
}

// 1. Queries in step with the .dql files.
console.log("Queries");
const { current, next } = generate();
if (current === next) ok("infraOptimizationQueries.ts matches infra-queries/*.dql");
else fail("infraOptimizationQueries.ts is out of step - run npm run gen:infra-queries");

// 2. The template builds.
console.log("Template");
await build({
  entryPoints: [join(root, "ui", "app", "infraOptimizationWorkflow.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(work, "workflow.mjs"),
  logLevel: "error",
});
const template = await import(pathToFileURL(join(work, "workflow.mjs")).href + "?" + Date.now());
try {
  const workflow = template.infraOptimizationWorkflow(template.DEFAULT_INFRA_INPUT);
  ok(`${Object.keys(workflow.tasks).length} tasks, template v${template.INFRA_TEMPLATE_VERSION}`);
} catch (error) {
  fail(`the workflow does not build: ${error.message}`);
}

// The shared script as a module, with the runtime's clients stubbed.
const reportFile = join(work, "report.mjs");
writeFileSync(
  reportFile,
  // Read at call time: each render sets its own stub.
  "const executionsClient = { getExecution: (args) => globalThis.__infraExecutions.getExecution(args), getTaskExecution: (args) => globalThis.__infraExecutions.getTaskExecution(args) };\n" +
    "const getEnvironmentUrl = () => globalThis.__infraEnvironment;\n" +
    template.infraReportScript() +
    "\nexport { renderData, checkData, checkNumbers, newKnown, collectNumbers, collect, rankActions, DOMAINS, TEXT };\n",
);
const report = await import(pathToFileURL(reportFile).href + "?" + Date.now());

/** checkData per domain, as collect() runs it. */
const checkSet = (byName) => {
  const issues = [];
  for (const entry of report.DOMAINS) {
    const own = Object.fromEntries(entry.queries.map((item) => [item.name, byName[item.name] ?? null]));
    issues.push(...report.checkData(own));
  }
  return issues;
};

/** collect() on saved results, as the notebook task would run it - no AI answer, so the fallback key actions. */
const render = async (byName, language) => {
  const scope = Object.fromEntries(report.DOMAINS.map((entry) => [entry.domain, entry.queries.some((item) => byName[item.name])]));
  globalThis.__infraEnvironment = "https://example.apps.dynatrace.com";
  globalThis.__infraExecutions = {
    getExecution: async () => ({ input: { scope, language } }),
    getTaskExecution: async ({ id }) => {
      if (id in byName) {
        if (byName[id] === null) throw new Error("failed");
        return { result: { records: byName[id] } };
      }
      return { result: { text: "" } };
    },
  };
  const result = await report.collect("test");
  const candidates = report.rankActions(byName, language, scope).map((line, index) => index + 1 + ". " + line);
  return ["## Key-action candidates (rank_actions)", candidates.join("\n"), "## Key actions (fallback)", result.summary, ...result.reports.flatMap((item) => [item.report, item.data])].join("\n\n");
};

// 3. Saved result sets.
console.log("Saved query results (infra-tests/fixtures)");
const sets = existsSync(fixtures) ? readdirSync(fixtures, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
if (sets.length === 0) console.log("  --   none saved - run with --live <context> to save a set");
for (const set of sets) {
  const byName = {};
  for (const name of QUERY_NAMES) {
    const file = join(fixtures, set, `${name}.json`);
    byName[name] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  }
  const issues = checkSet(byName);
  if (issues.length === 0) ok(`${set}: checkData finds nothing`);
  for (const issue of issues) fail(`${set}: ${issue}`);
  for (const language of ["Korean", "English"]) {
    const text = await render(byName, language);
    writeFileSync(join(work, `${set}-${language}.md`), text);
    const bad = ["undefined", "NaN", "[object Object]", " null", "null "].filter((word) => text.includes(word));
    if (bad.length > 0) fail(`${set} (${language}): the report shows ${bad.join(", ")}`);
    else ok(`${set} (${language}): report, candidates and tables render (tmp/infra-check/${set}-${language}.md)`);
  }
}

// 4. Synthetic sets: each must raise the issues it lists, no more and no fewer.
console.log("Synthetic sets (infra-tests/synthetic)");
const synthetic = join(root, "infra-tests", "synthetic");
for (const file of existsSync(synthetic) ? readdirSync(synthetic).filter((name) => name.endsWith(".json")) : []) {
  const { description, queries, expect } = JSON.parse(readFileSync(join(synthetic, file), "utf8"));
  const issues = checkSet(queries);
  const missing = expect.filter((part) => !issues.some((issue) => issue.includes(part)));
  const extra = issues.filter((issue) => !expect.some((part) => issue.includes(part)));
  if (missing.length === 0 && extra.length === 0) ok(`${file}: ${description}`);
  for (const part of missing) fail(`${file}: expected an issue with "${part}"`);
  for (const issue of extra) fail(`${file}: unexpected issue ${issue}`);
}

// 5. The number check on past AI mistakes.
console.log("Number check (infra-tests/number-check.json)");
const cases = JSON.parse(readFileSync(join(root, "infra-tests", "number-check.json"), "utf8"));
for (const item of cases) {
  const known = report.collectNumbers(item.records, report.newKnown());
  const { flagged } = report.checkNumbers(item.text, known, report.TEXT.Korean);
  const same = flagged.length === item.flagged.length && item.flagged.every((value) => flagged.includes(value));
  if (same) ok(item.description);
  else fail(`${item.description}: flagged [${flagged.join(", ")}], expected [${item.flagged.join(", ")}]`);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
