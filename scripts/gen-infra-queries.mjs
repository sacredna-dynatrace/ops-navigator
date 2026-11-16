// Writes ui/app/infraOptimizationQueries.ts from infra-queries/*.dql - the queries are edited and run
// (dtctl query -f) as plain DQL files, and the app gets them as JSON strings (they hold backticks).
// The doc comment at the top of the TS file is kept as it is.
//   node scripts/gen-infra-queries.mjs          write the file
//   node scripts/gen-infra-queries.mjs --check  fail when the file is out of step with the .dql files
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "ui", "app", "infraOptimizationQueries.ts");

// The order of INFRA_QUERIES: Kubernetes, host, disk, network.
export const QUERY_NAMES = [
  "k8s_cluster_cpu",
  "k8s_cluster_memory",
  "k8s_workload_cpu",
  "k8s_workload_memory",
  "k8s_rightsizing",
  "host_utilization",
  "disk_overutilized",
  "disk_underutilized",
  "network_saturated_interfaces",
  "network_updown_interfaces",
];

export const readQuery = (name) => readFileSync(join(root, "infra-queries", `${name}.dql`), "utf8").replace(/\r\n/g, "\n").trimEnd();

export const generate = () => {
  const current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  const start = current.indexOf("export const INFRA_QUERIES = {");
  if (start < 0) throw new Error("INFRA_QUERIES not found in " + target);
  const header = current.slice(0, start);
  const body = QUERY_NAMES.map((name) => `  ${name}: ${JSON.stringify(readQuery(name))},`).join("\n");
  return { current, next: `${header}export const INFRA_QUERIES = {\n${body}\n} as const;\n\nexport type InfraQueryName = keyof typeof INFRA_QUERIES;\n` };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { current, next } = generate();
  if (process.argv.includes("--check")) {
    if (current !== next) {
      console.error("ui/app/infraOptimizationQueries.ts is out of step with infra-queries/*.dql - run npm run gen:infra-queries");
      process.exit(1);
    }
    console.log("infraOptimizationQueries.ts matches infra-queries/*.dql");
  } else {
    writeFileSync(target, next);
    console.log(`wrote ${QUERY_NAMES.length} queries to ui/app/infraOptimizationQueries.ts`);
  }
}
