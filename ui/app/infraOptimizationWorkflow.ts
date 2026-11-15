import { INFRA_QUERIES, type InfraQueryName } from "./infraOptimizationQueries";
import { answerLanguageLine } from "./problemAnalysis";

/**
 * The Infrastructure Optimization Agent workflow, built from Dynatrace's template (host, disk,
 * Kubernetes and network sizing: Grail queries -> Davis generative AI -> report), with what the
 * Automation page adds:
 * - **delivery**: one email with every report (the template sent one per domain) or one notebook with
 *   every report and the queries behind it;
 * - **language**: the reports in Korean (default, polite style) or English.
 * Both live in the workflow input, so they can be changed later in the Workflows app without
 * recreating the workflow.
 *
 * Fixed from the template: the network report was handed the saturated interfaces twice and never the
 * up/down ones; `k8s_workload_cpu` stopped the whole run (`else: STOP`) when Kubernetes was out of
 * scope; the Kubernetes raw-data JSON had a stray and a missing comma; two query windows (see
 * infraOptimizationQueries.ts); the typo'd task name `ks8_report_prompt`.
 *
 * No SDK imports: the page and a plain Node script (to try the template with dtctl) both build it.
 */

/**
 * v10: workloads without a controller are left out of the advice, request and limit floors,
 * throttling without a unit, node counts explained from the allocatable per node, non-cloud instance
 * types dropped, and disks grouped by mount and size with a recommended size, container filesystems
 * left out (see infraOptimizationQueries.ts).
 * v9: the tenant leads the email subject ("[diw85600] ..."), and the email and notebook name the
 * environment with its URL - one inbox can get these from several tenants - and each domain's data
 * period. The saturated-interfaces query looks at 7 days instead of the default 2 h.
 * v8: requests, limits and minimum node counts computed in the queries; the AI presents them.
 * v7: corrected cluster and disk queries, values in display units, data rules for the AI, and a
 * key-actions summary on top (SUMMARY_TASK) - see infraOptimizationQueries.ts and DATA_RULES.
 * v6: email and notebook together ("both", the email links the notebook); Assist's disclaimer is
 * caught in any wording.
 * v5: one email with every report instead of one per domain; the domains chain on their reports.
 * v4: the cleanup really uses the trash (see cleanupScript); v3's script deleted for good.
 * v3: titled "[Ops Navigator] ..." - Dynatrace's own template is "Infrastructure Optimization Agent",
 * and the two could not be told apart in the Workflows app - and the first run moves older versions
 * to the trash (CLEANUP_TASK).
 * v2: the notebook's title names the domains it covers, and it gets a description.
 */
export const INFRA_TEMPLATE_VERSION = 10;
export const INFRA_WORKFLOW_TITLE = "[Ops Navigator] Infrastructure Optimization";
/** Finds every version, v1-v2 titled like Dynatrace's template included; the marker decides. */
export const INFRA_WORKFLOW_SEARCH = "Infrastructure Optimization";
export const CLEANUP_TASK = "cleanup_old_versions";
export const NOTEBOOK_TASK = "publish_notebook";
export const COMPOSE_EMAIL_TASK = "compose_email";
export const EMAIL_TASK = "email_report";
export const SUMMARY_TASK = "summary_prompt";
/** In the notebook task's script - the intent drops a workflow description - to recognize our workflow. */
export const INFRA_MARKER_PATTERN = /ops-navigator infra-optimization template v(\d+)/;
const MARKER = `ops-navigator infra-optimization template v${INFRA_TEMPLATE_VERSION}`;

export type InfraDomain = "kubernetes" | "host" | "disk" | "network";
/** "both": the notebook is made first and the email links to it. */
export type InfraDelivery = "email" | "notebook" | "both";
export type InfraLanguage = "Korean" | "English";
export type InfraOptimizationInput = {
  scope: Record<InfraDomain, boolean>;
  delivery: InfraDelivery;
  language: InfraLanguage;
  emails: { to: string[]; cc: string[]; bcc: string[] };
};

export const INFRA_DOMAINS: InfraDomain[] = ["kubernetes", "host", "disk", "network"];

export const DEFAULT_INFRA_INPUT: InfraOptimizationInput = {
  // Network needs the network-device extension; most tenants do not monitor it.
  scope: { kubernetes: true, host: true, disk: true, network: false },
  delivery: "email",
  language: "Korean",
  emails: { to: [], cc: [], bcc: [] },
};

/** What each domain queries and which prompt task writes its report. */
const DOMAINS: Record<InfraDomain, { prompt: string; queries: InfraQueryName[]; title: Record<InfraLanguage, string>; short: Record<InfraLanguage, string>; period: Record<InfraLanguage, string> }> = {
  kubernetes: {
    prompt: "k8s_report_prompt",
    queries: ["k8s_cluster_cpu", "k8s_cluster_memory", "k8s_workload_cpu", "k8s_workload_memory"],
    title: { Korean: "Kubernetes 최적화", English: "Kubernetes optimization" },
    short: { Korean: "K8s", English: "K8s" },
    period: { Korean: "7일 p95", English: "7 days, p95" },
  },
  host: {
    prompt: "host_report_prompt",
    queries: ["host_utilization"],
    title: { Korean: "호스트 최적화", English: "Host optimization" },
    short: { Korean: "호스트", English: "Host" },
    period: { Korean: "30일", English: "30 days" },
  },
  disk: {
    prompt: "disk_report_prompt",
    queries: ["disk_overutilized", "disk_underutilized"],
    title: { Korean: "디스크 최적화", English: "Disk optimization" },
    short: { Korean: "디스크", English: "Disk" },
    period: { Korean: "30일", English: "30 days" },
  },
  network: {
    prompt: "network_report_prompt",
    queries: ["network_saturated_interfaces", "network_updown_interfaces"],
    title: { Korean: "네트워크 최적화", English: "Network optimization" },
    short: { Korean: "네트워크", English: "Network" },
    period: { Korean: "포화 7일 p95, up/down 현재 상태", English: "saturation 7 days p95, up/down current state" },
  },
};

const QUERY_TITLES: Record<InfraQueryName, Record<InfraLanguage, string>> = {
  k8s_cluster_cpu: { Korean: "클러스터 CPU (7일 p95)", English: "Cluster CPU (7-day p95)" },
  k8s_cluster_memory: { Korean: "클러스터 메모리 (7일 p95)", English: "Cluster memory (7-day p95)" },
  k8s_workload_cpu: { Korean: "워크로드 CPU (7일 p95)", English: "Workload CPU (7-day p95)" },
  k8s_workload_memory: { Korean: "워크로드 메모리 (7일 p95)", English: "Workload memory (7-day p95)" },
  host_utilization: { Korean: "호스트 사용률 (30일 p90)", English: "Host utilization (30-day p90)" },
  disk_overutilized: { Korean: "과다 사용 디스크 (30일, 95% 초과)", English: "Over-utilized disks (30 days, > 95%)" },
  disk_underutilized: { Korean: "과소 사용 디스크 (30일, 50% 미만)", English: "Under-utilized disks (30 days, < 50%)" },
  network_saturated_interfaces: { Korean: "포화 인터페이스 (7일 p95 85% 이상)", English: "Saturated interfaces (7-day p95 >= 85%)" },
  network_updown_interfaces: { Korean: "Up/Down 인터페이스", English: "Up/down interfaces" },
};

// ---- Expressions ---------------------------------------------------------------------------------

const inScope = (domain: InfraDomain) => `input()["scope"]["${domain}"]`;
const BY_EMAIL = `input()["delivery"] in ["email", "both"]`;
const BY_NOTEBOOK = `input()["delivery"] in ["notebook", "both"]`;
const IS_ENGLISH = `input()["language"] == "English"`;
/** A Jinja string literal; the texts here hold no double quotes, this guards that. */
const literal = (text: string) => {
  if (text.includes('"') || text.includes("{{") || text.includes("\\")) throw new Error(`Not usable in an expression: ${text}`);
  return `"${text}"`;
};
/** Korean unless the workflow input says English - Korean is the default and the fallback. */
const byLanguage = (korean: string, english: string) => `{{ ${literal(english)} if ${IS_ENGLISH} else ${literal(korean)} }}`;
/** The shared polite-style line; it lets table cells off since this workflow's first test run. */
const LANGUAGE_LINE = byLanguage(answerLanguageLine("Korean"), answerLanguageLine("English"));
const withLanguage = (instruction: string) => (instruction ? `${instruction}\n${LANGUAGE_LINE}` : LANGUAGE_LINE);

/**
 * A query's records, or QUERY_FAILED when the query errored: the prompts run whatever their queries
 * did (states ANY), and a failed task's `result()` falls back to the default. Checked on diw85600 -
 * the prompt got "bad=QUERY_FAILED; good=[]" and the run ended SUCCESS.
 */
export const QUERY_FAILED = "QUERY_FAILED";
const records = (task: string) => `{{ result("${task}")["records"] | default("${QUERY_FAILED}") }}`;
/** Tells the AI what QUERY_FAILED means, so it reports the gap instead of inventing findings. */
const FAILED_LINE = `A data set given as ${QUERY_FAILED} could not be collected - its query failed, typically because that data source is not monitored in this environment. Say so briefly for that part, and do not invent findings for it.`;
/**
 * How to read the data, for every report. Without these the 2026-11-15 Kubernetes report (diw85600,
 * notebook 3976dac3) left most memory cells "-" although every value was there, recommended a 512 MiB
 * request "increase" for a workload already at 1 GiB, called a workload with 0 throttling "heavily
 * throttled", and priced an EC2 host whose instance type read "HVM domU". Told to keep a direction
 * rule, v7 still "raised" a 175 MiB limit to 150, so since v8 the queries compute every
 * recommendation (recommended_* fields) and the AI only presents and explains them.
 */
const DATA_RULES = [
  "Data rules: use only values present in the data, exactly as given - they are already in the unit their field name says (_mcores, _mib, _gib, _percent); do not convert or recompute them. Write '-' only for a value that is null in the data.",
  "Recommended values are already computed: present recommended_request_* and recommended_limit_* exactly as given, and never write a recommended number of your own. A null recommended value means keep the current setting - say 'keep' (유지), not a number. Explain each recommendation briefly from the usage, requests and limits.",
  "Where limit_below_request is true, the limit is a sum over containers some of which set no limit (0 means none set) - mention that the limit cannot be judged from the sum.",
  "For a cluster, the smallest safe node count is the larger of nodes_needed_for_cpu and nodes_needed_for_memory; never recommend fewer nodes than that, and recommend removing nodes only when it is below avg_node_count. Explain a node count only as the requests divided by (allocatable per node x 0.85), rounded up, using cpu_allocatable_per_node_mcores or mem_allocatable_per_node_gib - usage does not set it.",
  "EXCLUDED_NO_CONTROLLER counts pods without a controller (for example Spark executors or debug pods) and static pods: they are renamed on every run and sized elsewhere. Give their count in one line and no advice for them.",
  "throttling_p95 is a relative throttling indicator, not millicores: say whether throttling occurs and how it compares between workloads, never with a unit.",
  "Estimate costs only for a recognizable cloud instance type (for example m5.large, e2-standard-4, Standard_D4s_v3), and state the price basis you assume; otherwise write that the cost cannot be estimated - no amount and no percentage.",
  "Do not list items whose finding is NOMINAL; give their count only.",
].join("\n");

// ---- Tasks ---------------------------------------------------------------------------------------

type Conditions = { states: Record<string, string>; custom?: string; else?: string };
type TaskDefinition = {
  action: string;
  description: string;
  input: Record<string, unknown>;
  position: { x: number; y: number };
  predecessors: string[];
  conditions: Conditions;
  retry?: Record<string, unknown>;
};

const PROMPT_RETRY = { count: 2, delay: 30, failedLoopIterationsOnly: true };

const query = (name: InfraQueryName, domain: InfraDomain, position: { x: number; y: number }, after?: string): TaskDefinition => ({
  action: "dynatrace.automations:execute-dql-query",
  description: QUERY_TITLES[name].English,
  input: { query: INFRA_QUERIES[name] },
  position,
  predecessors: after ? [after] : [],
  // ANY: a domain whose report or email failed must not keep the next domain from running.
  conditions: { states: after ? { [after]: "ANY" } : {}, custom: `{{ ${inScope(domain)} }}`, else: "SKIP" },
});

const prompt = (domain: InfraDomain, position: { x: number; y: number }, text: string, instruction: string, supplementary: string): TaskDefinition => ({
  action: "dynatrace.davis.workflow.actions:prompt-generative-ai",
  description: `Writes the ${DOMAINS[domain].title.English.toLowerCase()} report with Dynatrace generative AI`,
  input: { config: "disabled", autoTrim: true, prompt: text, instruction: withLanguage([instruction, DATA_RULES, FAILED_LINE].filter(Boolean).join("\n")), supplementary },
  position,
  predecessors: DOMAINS[domain].queries,
  // ANY: one failed query leaves the report to the others (see records()).
  conditions: { states: Object.fromEntries(DOMAINS[domain].queries.map((name) => [name, "ANY"])), custom: `{{ ${inScope(domain)} }}`, else: "SKIP" },
  retry: PROMPT_RETRY,
});

const K8S_DATA = `{
  "Cluster optimization": {
    "CPU": ${records("k8s_cluster_cpu")},
    "Memory": ${records("k8s_cluster_memory")}
  },
  "Workload optimization": {
    "CPU": ${records("k8s_workload_cpu")},
    "Memory": ${records("k8s_workload_memory")}
  }
}`;

const K8S_PROMPT = `Provide a \`Kubernetes Optimization Report\`, in markdown for these 2 usecases:

# 1. Optimize pod sizing
Goal: identify pod optimization opportunities and recommend Kubernetes pod \`requests\` and \`limits\` for CPU and memory that reduce OOMKills/throttling while avoiding wasted reserved capacity.
Use the data provided in the context. Findings and the recommended \`requests\` and \`limits\` are already computed for each example; present them and explain each one from the numbers.

# 2. Optimize cluster sizing
Goals:
1. Shutdown unneeded nodes to save on cost, assuming Pods have already been optimized above.
2. Reduce over-provisioned nodes to save on cost
3. Increase the size of under-provisioned nodes to reduce risk
Use the data provided in the context. Findings are already provided for scale; however, still analyze the numbers and produce a recommendation for each example cluster. For instance, you could recommend reducing the number of nodes by 3 or scale down from a \`m7a.2xlarge\` to a \`m7a.large\`.
A cluster's CPU and memory findings must be read together: the node count can go no lower than the larger of nodes_needed_for_cpu and nodes_needed_for_memory.
If possible, using the recommendations you generate and the instanceType and cloudType, estimate potential cost savings.

# Golden rules
1. Always show all of the provided findings in the context
2. Show the metrics that were included in the context for each example
3. Do not skip examples and always indicate that they are just a small sample of the total findings provided at the end of the report.
4. Use the recommended values from the context as they are; do not adjust them.
5. Be sure to include the count of similar findings from the context, when giving the sample recommendations.`;

const K8S_INSTRUCTION = `Be sure the report includes an overview, summary counts, examples, and if possible an estimate of cost savings.
Format examples in tables instead of bulleted lists.
Where applicable show relative percentages, e.g. 100 used and 1000 allocatable is 10% utilized.`;

const HOST_PROMPT = `Provide a markdown report for the following use case:
## Optimize host sizing
If a user wants to optimize the size of their hosts, they generally have three goals:
1. Shutdown potentially unused hosts
2. Reduce over-provisioned hosts to save on cost
3. Increase the size of under-provisioned hosts to reduce risk

Be sure to provide an overview (including number of hosts per utilization) and any insights from the data provided. Give an estimated range of cost savings only for hosts whose instanceType is set; for a host without one, write that its cost cannot be estimated - no amount and no percentage.`;

const DISK_PROMPT = `Provide a markdown report for:
## Optimize disk usage
If disk utilization is not optimized, it can result in either wasted spend or worse preventable outages. If the user asked for disk optimization, you should provide two things:
1. Disks that are overutilized and likely to fill
2. Disks that are underutilized and will likely never fill, which can safely be shrunken
Note: disks that are less than 50GiB are not relevant.
For over-utilized disks, disk_size_gib is the disk's size, used_gib its average use, and never_used_gib the free space it never dipped below in 30 days.
Under-utilized disks come grouped by mount point and size: each group gives how many disks it holds (disks), some of their hosts, the 30-day peak use (max_used_gib, max_disk_percent), the size to shrink each disk to (recommended_size_gib: the peak plus 30%) and the space the whole group frees (reclaimable_gib). disk_count, group_count and total_reclaimable_gib are the totals. Show the groups in a table as given, describe each group only by its own numbers - never generalize one group's size to all disks - and write that a disk is shrunk TO recommended_size_gib, freeing reclaimable_gib. For database data volumes, add that expected data growth should be checked before shrinking.`;

/** The key-actions summary: read only the finished reports, so it repeats no number they lack. */
const ANY_SCOPE = INFRA_DOMAINS.map(inScope).join(" or ");
const reportText = (domain: InfraDomain) => `{{ result("${DOMAINS[domain].prompt}")["text"] | default("NOT_RUN") }}`;
const SUMMARY_DATA = INFRA_DOMAINS.map((domain) => `## ${DOMAINS[domain].title.English} report\n${reportText(domain)}`).join("\n\n");
const SUMMARY_PROMPT = `Below are infrastructure optimization reports, one per domain (a report given as NOT_RUN was out of scope or failed - skip it).
Write the key actions across all of them: 3 to 5 bullet points, the highest risk or the largest saving first. Each bullet names the affected cluster, workload, host or disk and the concrete change, with the number from the report that justifies it.
Then one line with the total cost impact the reports give, or that none could be estimated.`;
const SUMMARY_INSTRUCTION = "Start directly with the first bullet - no title, no introduction. Use only facts and numbers that appear in the reports; do not add new findings, and do not repeat a recommendation a report itself marks as not advisable.";

const NETWORK_PROMPT = `Provide a markdown report for:
## Identify saturated interfaces
Saturated interfaces could cause network slowdowns and require either upgrades or rerouting traffic.

## Identify up/down interfaces
Network admininstrators refer to interfaces as "up/down", when the administrative status is "up" but the operational status is "down". Sometimes this is normal, e.g. a port for a user's computer is down; however, many times this can also mean that a port that is intended to be up is for some reason down, perhaps due to a cable or NIC issue.`;

/**
 * The part the notebook and the email share: the run's input, the time, and each in-scope domain's
 * report read back from its prompt task (empty when the task was skipped or failed). Both deliveries
 * then name the same domains in their title or subject.
 */
const collectReports = () => {
  const domains = INFRA_DOMAINS.map((domain) => ({
    domain,
    task: DOMAINS[domain].prompt,
    title: DOMAINS[domain].title,
    short: DOMAINS[domain].short,
    period: DOMAINS[domain].period,
    queries: DOMAINS[domain].queries.map((name) => ({ title: QUERY_TITLES[name], query: INFRA_QUERIES[name] })),
  }));
  return `const DOMAINS = ${JSON.stringify(domains, null, 2)};

const TEXT = {
  Korean: {
    name: "[인프라 최적화] ",
    all: "전체",
    none: "리포트 없음",
    created: "생성",
    by: "[Ops Navigator] Infrastructure Optimization",
    heading: "# 인프라 최적화 리포트",
    createdAt: "생성 시각",
    environment: "환경",
    period: "데이터 기간",
    scope: "분석 범위",
    missing: "_이 영역의 리포트가 생성되지 않았습니다._",
    missingList: "리포트를 받지 못한 영역",
    data: "원본 데이터 쿼리",
    footer: "Ops Navigator의 Infrastructure Optimization 워크플로가 생성했습니다. 리포트는 Dynatrace 생성형 AI가 작성했으며, 아래 쿼리로 원본 데이터를 다시 확인할 수 있습니다.",
    mailFooter: "Ops Navigator의 Infrastructure Optimization 워크플로가 보낸 메일입니다. 리포트는 Dynatrace 생성형 AI가 작성했습니다. 원본 데이터는 결과 전달에 노트북을 함께 선택해 실행하거나, Workflows 앱의 실행 기록에서 각 쿼리 태스크의 결과로 확인할 수 있습니다.",
    mailFooterLinked: "Ops Navigator의 Infrastructure Optimization 워크플로가 보낸 메일입니다. 리포트는 Dynatrace 생성형 AI가 작성했습니다. 원본 데이터 쿼리는 위 노트북에서 확인할 수 있습니다.",
    notebook: "노트북",
    notebookLink: "원본 데이터 쿼리와 함께 보기",
    summary: "## 핵심 요약",
  },
  English: {
    name: "[Infra Optimization] ",
    all: "All",
    none: "no report",
    created: "Created",
    by: "[Ops Navigator] Infrastructure Optimization",
    heading: "# Infrastructure optimization report",
    createdAt: "Created",
    environment: "Environment",
    period: "Data period",
    scope: "Scope",
    missing: "_No report was produced for this domain._",
    missingList: "No report for",
    data: "Raw data queries",
    footer: "Created by the Infrastructure Optimization workflow of Ops Navigator. The reports are written by Dynatrace generative AI; the queries below show the data behind them.",
    mailFooter: "Sent by the Infrastructure Optimization workflow of Ops Navigator. The reports are written by Dynatrace generative AI. For the raw data, also choose notebook delivery, or open the run in the Workflows app and look at each query task's result.",
    mailFooterLinked: "Sent by the Infrastructure Optimization workflow of Ops Navigator. The reports are written by Dynatrace generative AI. The raw data queries are in the notebook above.",
    notebook: "Notebook",
    notebookLink: "open with the raw data queries",
    summary: "## Key actions",
  },
};

// Assist appends a disclaimer to non-English answers, worded differently each time ("Dynatrace Assist는
// 공식적으로 영어로만 지원되며 ...", "참고: Dynatrace Assist는 공식적으로 영어만 지원되며 ..."). Any line
// naming Assist, English and support goes, whatever the order or wording.
const LANGUAGE_NOTE = /^(?=.*Dynatrace Assist)(?=.*(영어|English))(?=.*(지원|support)).*$|^.*(영어로?만 지원|only (officially )?supported in English).*$/gim;
// Assist's sign-off when its agentic features are off ("If you want help with creating DQL queries,
// ask your admin to enable Agentic AI." - end of the disk report, notebook 3976dac3).
const ASSIST_PROMO = /^.*(enable Agentic AI|Agentic AI(를|을)? 활성화).*$/gim;
// Removing them can leave blank lines and a rule right under the title ("# ...\\n\\n\\n\\n---"), or a
// rule left dangling at the end; all go.
const tidy = (report) => report.replace(LANGUAGE_NOTE, "").replace(ASSIST_PROMO, "").replace(/\\n{3,}/g, "\\n\\n").replace(/^(#{1,6} [^\\n]*)\\n+---[ \\t]*\\n+/m, "$1\\n\\n").replace(/\\n+---[ \\t]*\\s*$/, "").trim();

async function collect(execution_id) {
  const execution = await executionsClient.getExecution({ id: execution_id });
  const input = execution.input ?? {};
  const language = input.language === "English" ? "English" : "Korean";
  const text = TEXT[language];
  const scope = input.scope ?? {};
  // Korea time, written out by hand: the runtime's Intl time zones are not guaranteed.
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " KST";

  const covered = DOMAINS.filter((entry) => scope[entry.domain] === true);
  const reports = [];
  for (const entry of covered) {
    let report = "";
    try {
      const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: entry.task });
      report = tidy(String(task.result?.text ?? ""));
    } catch (error) {
      report = "";
    }
    reports.push({ entry, report });
  }

  // Titles and subjects name the domains that produced a report ("All" for all four): a list of
  // notebooks or mails shows nothing else.
  const produced = reports.filter((item) => item.report).map((item) => item.entry);
  const label = produced.length === DOMAINS.length ? text.all : produced.length > 0 ? produced.map((entry) => entry.short[language]).join("·") : text.none;
  const title = text.name + label + " · " + stamp;
  const missing = reports.filter((item) => !item.report).map((item) => item.entry.title[language]);
  const scopeLine = covered.map((entry) => entry.title[language]).join(", ");
  // How far back each domain looks: the reports do not say, and a reader cannot tell minutes from days.
  const periodLine = covered.map((entry) => entry.short[language] + " " + entry.period[language]).join(" · ");

  // The key actions across the reports (SUMMARY_TASK), shown on top; none when it did not run.
  let summary = "";
  try {
    const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: "${SUMMARY_TASK}" });
    summary = tidy(String(task.result?.text ?? ""));
  } catch (error) {
    summary = "";
  }

  // Which tenant ran this: one person can get these mails from several. The tenant id is the URL's
  // first host label (https://diw85600.apps.dynatrace.com -> diw85600).
  let environmentUrl = "";
  try {
    environmentUrl = getEnvironmentUrl().replace(/\\/$/, "");
  } catch (error) {
    environmentUrl = "";
  }
  const tenant = environmentUrl.replace(/^https?:\\/\\//, "").split(".")[0];
  const environmentLine = tenant ? "**" + text.environment + ":** " + tenant + " (" + environmentUrl + ")" : "";
  return { language, text, stamp, covered, reports, title, missing, scopeLine, summary, environmentUrl, tenant, environmentLine, periodLine };
}
`;
};

/** The notebook: title and scope, each report, then the queries behind it to rerun. */
const notebookScript = () => `// ${MARKER}
import { executionsClient } from "@dynatrace-sdk/client-automation";
import { documentsClient } from "@dynatrace-sdk/client-document";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

// One notebook with every report of this run and the queries behind it (delivery: notebook).
${collectReports()}
// Section ids only need to be unique within the notebook.
let sectionCount = 0;
const newId = () => "section-" + String(++sectionCount);
const markdown = (text) => ({ id: newId(), type: "markdown", markdown: text });
const dql = (title, query) => ({ id: newId(), type: "dql", title, showTitle: true, state: { input: { value: query, timeframe: { from: "now()-2h", to: "now()" } } } });

export default async function ({ execution_id }) {
  const { language, text, stamp, reports, title, missing, scopeLine, summary, environmentUrl, environmentLine, periodLine } = await collect(execution_id);

  const sections = [markdown(text.heading + "\\n\\n" + (environmentLine ? environmentLine + "  \\n" : "") + "**" + text.createdAt + ":** " + stamp + "  \\n**" + text.scope + ":** " + scopeLine + "  \\n**" + text.period + ":** " + periodLine + "\\n\\n" + text.footer)];
  if (summary) sections.push(markdown(text.summary + "\\n\\n" + summary));
  for (const { entry, report } of reports) {
    // The report brings its own title; the domain heading is only for a missing one.
    sections.push(markdown(report ? report : "## " + entry.title[language] + "\\n\\n" + text.missing));
    sections.push(markdown("#### " + entry.title[language] + " - " + text.data));
    for (const item of entry.queries) sections.push(dql(item.title[language], item.query));
  }

  const description = text.scope + ": " + scopeLine + (missing.length > 0 ? " (" + text.none + ": " + missing.join(", ") + ")" : "") + " · " + text.created + ": " + stamp + " · " + text.by;
  const content = { version: "7", defaultTimeframe: { from: "now()-2h", to: "now()" }, sections };
  const document = await documentsClient.createDocument({
    body: { name: title, description, type: "notebook", content: new Blob([JSON.stringify(content)], { type: "application/json" }) },
  });
  const url = environmentUrl + "/ui/apps/dynatrace.notebooks/notebook/" + document.id;
  return { notebookId: document.id, name: title, url };
}
`;

/**
 * The one email (delivery: email or both): every report of the run in a single markdown body, with the
 * same title the notebook gets as its subject. Raw data stays out - it made the template's Kubernetes
 * mail long and unreadable. With "both" the notebook is made first and linked at the top; otherwise
 * the footer says where the raw data is.
 */
const composeEmailScript = () => `// ${MARKER}
import { executionsClient } from "@dynatrace-sdk/client-automation";
import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";

${collectReports()}
export default async function ({ execution_id }) {
  const { language, text, stamp, reports, title, missing, scopeLine, summary, tenant, environmentLine, periodLine } = await collect(execution_id);
  // The notebook this run made, if it made one (delivery: both); skipped or failed -> no link.
  let notebookUrl = null;
  try {
    const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: "${NOTEBOOK_TASK}" });
    notebookUrl = typeof task.result?.url === "string" ? task.result.url : null;
  } catch (error) {
    notebookUrl = null;
  }
  const link = notebookUrl ? "  \\n**" + text.notebook + ":** [" + text.notebookLink + "](" + notebookUrl + ")" : "";
  const parts = [text.heading, (environmentLine ? environmentLine + "  \\n" : "") + "**" + text.createdAt + ":** " + stamp + "  \\n**" + text.scope + ":** " + scopeLine + "  \\n**" + text.period + ":** " + periodLine + (missing.length > 0 ? "  \\n**" + text.missingList + ":** " + missing.join(", ") : "") + link];
  if (summary) parts.push(text.summary + "\\n\\n" + summary);
  for (const { entry, report } of reports) {
    parts.push("---");
    parts.push(report ? report : "## " + entry.title[language] + "\\n\\n" + text.missing);
  }
  parts.push("---");
  parts.push("_" + (notebookUrl ? text.mailFooterLinked : text.mailFooter) + "_");
  // The tenant leads the subject so an inbox fed by several tenants sorts and filters by it; the
  // notebook keeps the plain title - it lives in its tenant already.
  return { subject: (tenant ? "[" + tenant + "] " : "") + title, body: parts.join("\\n\\n"), notebookUrl };
}
`;

/**
 * Moves this template's older versions to the Workflows trash. Only workflows whose notebook task
 * carries the marker with a lower version: Dynatrace's own template and same-version copies made on
 * purpose stay. Runs as the workflow's actor - the app itself may not delete workflows. Never throws:
 * a refused delete must not fail the report, it is listed in the result instead.
 *
 * The delete goes through the REST API with `?trash=true`, not workflowsClient.deleteWorkflow: the
 * API deletes permanently by default, and the workflow runtime's SDK is older than the trash - it has
 * no getTrashedWorkflows and drops a `trash` option. Both were learned the hard way on diw85600
 * (2026-11-15): the first v3 test run removed v1 and v2 for good, and a dummy deleted with
 * `trash: true` never reached the trash, while one deleted by REST did. The trash is read back the
 * same way, so the result says whether each one really landed there.
 */
const cleanupScript = () => `// ${MARKER}
import { executionsClient, workflowsClient } from "@dynatrace-sdk/client-automation";
import { httpClient } from "@dynatrace-sdk/http-client";

const CURRENT = ${INFRA_TEMPLATE_VERSION};
const MARKER = /ops-navigator infra-optimization template v(\\d+)/;

export default async function ({ execution_id }) {
  const deleted = [];
  const failed = [];
  try {
    const execution = await executionsClient.getExecution({ id: execution_id });
    const self = execution.workflow;
    const list = await workflowsClient.getWorkflows({ search: "${INFRA_WORKFLOW_SEARCH}", limit: 100 });
    for (const item of list.results) {
      if (item.id === self) continue;
      const full = await workflowsClient.getWorkflow({ id: item.id });
      const script = String(full.tasks?.["${NOTEBOOK_TASK}"]?.input?.script ?? "");
      const match = MARKER.exec(script);
      if (!match || Number(match[1]) >= CURRENT) continue;
      try {
        // Into the trash (recoverable for 30 days) - without ?trash=true the API deletes for good.
        await httpClient.send({ url: "/platform/automation/v1/workflows/" + encodeURIComponent(full.id) + "?trash=true", method: "DELETE" });
        deleted.push({ id: full.id, title: full.title, version: Number(match[1]) });
      } catch (error) {
        failed.push({ id: full.id, title: full.title, version: Number(match[1]), reason: String(error?.message ?? error) });
      }
    }
  } catch (error) {
    failed.push({ reason: String(error?.message ?? error) });
  }
  // Read the trash back: proof that what was removed can still be restored.
  if (deleted.length > 0) {
    try {
      const response = await httpClient.send({ url: "/platform/automation/v1/trash/workflows", method: "GET" });
      const trash = await response.body("json");
      const ids = new Set((trash.results ?? []).map((entry) => entry.id));
      for (const entry of deleted) entry.inTrash = ids.has(entry.id);
    } catch (error) {
      for (const entry of deleted) entry.inTrash = null;
    }
  }
  return { deleted, failed };
}
`;
const taskDefinitions = (): Record<string, TaskDefinition> => ({
  // Housekeeping beside the reports: nothing waits for it, so it cannot hold them up.
  [CLEANUP_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Moves older versions of this workflow made by Ops Navigator to the trash",
    input: { script: cleanupScript() },
    position: { x: 3, y: 1 },
    predecessors: [],
    conditions: { states: {} },
  },
  // Kubernetes - the four queries run side by side.
  k8s_cluster_cpu: query("k8s_cluster_cpu", "kubernetes", { x: -2, y: 1 }),
  k8s_cluster_memory: query("k8s_cluster_memory", "kubernetes", { x: -1, y: 1 }),
  k8s_workload_cpu: query("k8s_workload_cpu", "kubernetes", { x: 1, y: 1 }),
  k8s_workload_memory: query("k8s_workload_memory", "kubernetes", { x: 2, y: 1 }),
  k8s_report_prompt: prompt("kubernetes", { x: 0, y: 2 }, K8S_PROMPT, K8S_INSTRUCTION, K8S_DATA),
  // The domains run one after another, as in the template, so the AI calls do not all land at once:
  // each waits for the report before it (ANY - a skipped or failed one does not hold the next back).
  host_utilization: query("host_utilization", "host", { x: -1, y: 3 }, "k8s_report_prompt"),
  host_report_prompt: prompt("host", { x: 0, y: 4 }, HOST_PROMPT, "Instead of bulleted list, format example hosts in a table.", `Use this analysis of p90 CPU and Memory for the past 30 days:\n${records("host_utilization")}`),
  disk_overutilized: query("disk_overutilized", "disk", { x: -1, y: 5 }, "host_report_prompt"),
  disk_underutilized: query("disk_underutilized", "disk", { x: 0, y: 5 }, "host_report_prompt"),
  disk_report_prompt: prompt("disk", { x: 0, y: 6 }, DISK_PROMPT, "", `{\n  "Overutilized disks": ${records("disk_overutilized")},\n  "Underutilized disks": ${records("disk_underutilized")}\n}`),
  network_updown_interfaces: query("network_updown_interfaces", "network", { x: -1, y: 7 }, "disk_report_prompt"),
  network_saturated_interfaces: query("network_saturated_interfaces", "network", { x: 0, y: 7 }, "disk_report_prompt"),
  network_report_prompt: prompt("network", { x: 0, y: 8 }, NETWORK_PROMPT, "", `{\n  "Saturated interfaces": ${records("network_saturated_interfaces")},\n  "Up/Down interfaces": ${records("network_updown_interfaces")}\n}`),
  // The key actions across every report, for the top of the notebook and the email (ANY - it sums up
  // whatever reports did come out).
  [SUMMARY_TASK]: {
    action: "dynatrace.davis.workflow.actions:prompt-generative-ai",
    description: "Sums up the key actions across all reports with Dynatrace generative AI",
    input: { config: "disabled", autoTrim: true, prompt: SUMMARY_PROMPT, instruction: withLanguage(SUMMARY_INSTRUCTION), supplementary: SUMMARY_DATA },
    position: { x: 0, y: 9 },
    predecessors: ["network_report_prompt"],
    conditions: { states: { network_report_prompt: "ANY" }, custom: `{{ ${ANY_SCOPE} }}`, else: "SKIP" },
    retry: PROMPT_RETRY,
  },
  // Delivery: one notebook and/or one email with every report (ANY - the reports that did come out go
  // out when a later step failed). The notebook comes first so the email can link to it.
  [NOTEBOOK_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Saves every report of the run, with its queries, as one notebook (delivery: notebook or both)",
    input: { script: notebookScript() },
    position: { x: 0, y: 10 },
    predecessors: [SUMMARY_TASK],
    conditions: { states: { [SUMMARY_TASK]: "ANY" }, custom: `{{ ${BY_NOTEBOOK} }}`, else: "SKIP" },
  },
  [COMPOSE_EMAIL_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Puts every report of the run into one email body, linking the notebook when there is one (delivery: email or both)",
    input: { script: composeEmailScript() },
    position: { x: 0, y: 11 },
    predecessors: [NOTEBOOK_TASK],
    // ANY: a skipped notebook (email only) or a failed one still lets the email go out.
    conditions: { states: { [NOTEBOOK_TASK]: "ANY" }, custom: `{{ ${BY_EMAIL} }}`, else: "SKIP" },
  },
  [EMAIL_TASK]: {
    action: "dynatrace.email:send-email",
    description: "Sends the one report email (delivery: email)",
    input: {
      to: ['{{ input()["emails"]["to"] }}'],
      cc: ['{{ input()["emails"]["cc"] }}'],
      bcc: ['{{ input()["emails"]["bcc"] }}'],
      subject: `{{ result("${COMPOSE_EMAIL_TASK}")["subject"] }}`,
      content: `{{ result("${COMPOSE_EMAIL_TASK}")["body"] }}`,
    },
    position: { x: 0, y: 12 },
    predecessors: [COMPOSE_EMAIL_TASK],
    conditions: { states: { [COMPOSE_EMAIL_TASK]: "OK" }, custom: `{{ ${BY_EMAIL} }}`, else: "SKIP" },
  },
});

/**
 * The tasks, each carrying its own key as `name`: the Workflows app's create-workflow intent opens an
 * empty editor without it (see analyzeWorkflow.ts).
 */
export const infraOptimizationTasks = () =>
  Object.fromEntries(Object.entries(taskDefinitions()).map(([name, task]) => [name, { name, ...task }]));

/**
 * The workflow as the create-workflow intent takes it. Manual trigger: the user tries a run, then
 * sets a schedule. Private, like the template - the user can share it from the Workflows app.
 */
export const infraOptimizationWorkflow = (input: InfraOptimizationInput) => ({
  title: INFRA_WORKFLOW_TITLE,
  type: "STANDARD" as const,
  isPrivate: true,
  hourlyExecutionLimit: 10,
  input,
  tasks: infraOptimizationTasks(),
});

/** Splits a typed recipient list ("a@x.com, b@y.com"). */
export const parseRecipients = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const isEmailAddress = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

/**
 * A saved workflow's input in one line for the Automation page ("K8s·호스트·디스크 / 노트북 / 한국어"),
 * or null when it is not this template's input (edited by hand in the Workflows app, say).
 */
export const summarizeInfraInput = (input: unknown): string | null => {
  if (typeof input !== "object" || input === null) return null;
  const { scope, delivery, language, emails } = input as Partial<InfraOptimizationInput>;
  if (typeof scope !== "object") return null;
  const domains = INFRA_DOMAINS.filter((domain) => scope[domain] === true).map((domain) => DOMAINS[domain].short.Korean);
  const all = domains.length === INFRA_DOMAINS.length ? "전체" : domains.join("·") || "범위 없음";
  const recipients = emails?.to?.length ? ` (${emails.to.join(", ")})` : "";
  const how = delivery === "notebook" ? "노트북" : delivery === "both" ? `이메일${recipients} + 노트북` : `이메일${recipients}`;
  return `${all} / ${how} / ${language === "English" ? "English" : "한국어"}`;
};
