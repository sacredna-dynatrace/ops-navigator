import { INFRA_QUERIES, type InfraQueryName } from "./infraOptimizationQueries";
import { MEANING_KINDS, REPORT_WRITER, TABLE_NOTES } from "./infraReportText";
import { answerLanguageLine } from "./problemAnalysis";

/**
 * The Infrastructure Optimization Agent workflow, built from Dynatrace's template (host, disk,
 * Kubernetes and network sizing: Grail queries -> report), with what the
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
 * v22: no page-cache note for a workload with OOM kills - page cache is reclaimed before an OOM
 * kill, so the note read as doubting a real need (rad60188, loki-ingester).
 * v21: container series without a container name (init containers - the Dynatrace operator's
 * install-oneagent) are left out of every Kubernetes query: they hid unset requests and limits and
 * made limits look partly set. The key actions keep the page-cache caveat for a working set at its
 * limit, and the partly-set-limits note says which resource.
 * v20: the scripts write the reports (infraReportText.ts) - each finding's meaning and change as a
 * fixed sentence under its table, and each domain's overview, node counts and priorities from the
 * records. The four per-domain AI reports are gone: every run brought a new kind of mistake in them
 * (throttling blamed on the requests, "0개" findings, a workload in the wrong cluster, a value from
 * the row below). The AI only picks the key actions from a ranked list that carries the numbers
 * (rank_actions); the resources line under them is the script's. The queries no longer wait on the
 * reports, so they run side by side.
 * v19: the queries checked against Kubernetes' own rules instead of report by report - unset requests
 * and limits are null (a sum made them 0, so NO_REQUESTS_SET and NO_LIMIT_SET never fired), memory is
 * summed per container like CPU, the replicas count in the after-rightsizing totals (a DaemonSet on 4
 * nodes counted once: 49% analyzed for 75%), memory INCREASE_LIMITS means a working set near the limit
 * (requests equal to the limit are Guaranteed QoS, not a risk), requests and limits are advised each
 * on its own, hosts without data for 24 h are NOT_REPORTING (6 of 8 GKE node hosts, and a stopped VM
 * told to grow), and the meanings say where throttling comes from. The scripts check the query results
 * against each other (checkData) and show any contradiction as a data check above the tables; the
 * same check runs on saved results before a push (npm run test:infra).
 * v18: limits and memory INCREASE_LIMITS described as what they are (a limit reserves nothing; the
 * memory finding means no room above the requests), only the findings the data has, left-out pods
 * split into no-controller and static with sample names (no assumed Spark), and a fixed change per
 * host group (OVERPROVISIONED had been told to shut down).
 * v17: each finding's meaning spelled out (CPU findings had been described as eviction risks), the
 * values after rightsizing only from the _after fields, Kubernetes node hosts given a range and a
 * pointer only, and the summary takes node changes from the Kubernetes report alone (it had turned
 * a 100% host CPU into "add nodes" for a cluster that keeps its 2).
 * v16: cleanup_old_versions moves to its own spot - v15 put k8s_rightsizing on it, and the Workflows
 * app refused to save the workflow.
 * v15: one node finding per cluster (no memory-only scale-down), host groups with their ranges and
 * Kubernetes nodes per cluster, a new k8s_rightsizing query (requests and nodes after rightsizing,
 * and how much of the requests the advice covers), and fixed wording for workload counts.
 * v14: the data rules move from the instructions (sent at 3,853 to 4,437 characters against a 2,500
 * limit, auto-trimmed) into the prompt (5,000), checked when the template is built (promptInput);
 * node counts are written as CPU and memory counts, never as a binding or limiting resource.
 * v13: the number check matches each number against values of the kind its unit names (%, mcores,
 * MiB, GiB, counts); no money amounts at all; hosts that are Kubernetes nodes are their own group;
 * host values named _percent; host total; wording rules for scheduling and memory throttling.
 * v12: numbers in the AI's text that no query returned are marked and listed under the report
 * (checkNumbers) - the first check caught "8,610 / (3,500 x 0.85) = 3.26, so 4 nodes" (2.89; the
 * query says 3).
 * v11: the notebook and email draw the data tables from the query results (TABLES) and the AI writes
 * the text around them; clusters give minimum_nodes and the resource that sets it, workloads their
 * analyzed and left-out totals; the summary keeps each number with its item.
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
export const INFRA_TEMPLATE_VERSION = 22;
export const INFRA_WORKFLOW_TITLE = "[Ops Navigator] Infrastructure Optimization";
/** Finds every version, v1-v2 titled like Dynatrace's template included; the marker decides. */
export const INFRA_WORKFLOW_SEARCH = "Infrastructure Optimization";
export const CLEANUP_TASK = "cleanup_old_versions";
export const NOTEBOOK_TASK = "publish_notebook";
export const COMPOSE_EMAIL_TASK = "compose_email";
export const EMAIL_TASK = "email_report";
export const SUMMARY_TASK = "summary_prompt";
export const RANK_TASK = "rank_actions";
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

/** What each domain queries, and its names. */
const DOMAINS: Record<InfraDomain, { queries: InfraQueryName[]; title: Record<InfraLanguage, string>; short: Record<InfraLanguage, string>; period: Record<InfraLanguage, string> }> = {
  kubernetes: {
    queries: ["k8s_cluster_cpu", "k8s_cluster_memory", "k8s_workload_cpu", "k8s_workload_memory", "k8s_rightsizing"],
    title: { Korean: "Kubernetes 최적화", English: "Kubernetes optimization" },
    short: { Korean: "K8s", English: "K8s" },
    period: { Korean: "7일 p95", English: "7 days, p95" },
  },
  host: {
    queries: ["host_utilization"],
    title: { Korean: "호스트 최적화", English: "Host optimization" },
    short: { Korean: "호스트", English: "Host" },
    period: { Korean: "30일", English: "30 days" },
  },
  disk: {
    queries: ["disk_overutilized", "disk_underutilized"],
    title: { Korean: "디스크 최적화", English: "Disk optimization" },
    short: { Korean: "디스크", English: "Disk" },
    period: { Korean: "30일", English: "30 days" },
  },
  network: {
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
  k8s_rightsizing: { Korean: "Pod 최적화 후 예상 (7일 p95)", English: "After pod rightsizing (7-day p95)" },
  host_utilization: { Korean: "호스트 사용률 (30일 p90)", English: "Host utilization (30-day p90)" },
  disk_overutilized: { Korean: "과다 사용 디스크 (30일, 95% 초과, 동작 중인 호스트)", English: "Over-utilized disks (30 days, > 95%, hosts still reporting)" },
  disk_underutilized: { Korean: "과소 사용 디스크 (30일, 50% 미만, 동작 중인 호스트)", English: "Under-utilized disks (30 days, < 50%, hosts still reporting)" },
  network_saturated_interfaces: { Korean: "포화 인터페이스 (7일 p95 85% 이상)", English: "Saturated interfaces (7-day p95 >= 85%)" },
  network_updown_interfaces: { Korean: "Up/Down 인터페이스", English: "Up/down interfaces" },
};

/**
 * The data tables under each report, drawn by the notebook and email scripts straight from the query
 * results. The AI used to copy the examples into its own tables and mixed up rows - loki-ingester's
 * throttling 20,414 landed on loki-distributor (2,016) in notebook 3869dd80 - so since v11 it writes
 * the text and the scripts draw every number.
 * - byFinding: one table per finding (findingField) with its count (countField) and examples; a
 *   finding without examples gets its count in a list. `vertical` draws each example as a two-column
 *   table titled by that field - for clusters, which have many figures and few rows.
 * - rows: one table of the rows.
 * `nested` reads the groups or rows from the first record's field of that name; `totals` are fields
 * of that record shown above. `keep` columns show null as "keep" (a recommendation that keeps the
 * current value).
 */
type TableColumn = { field: string; header: Record<InfraLanguage, string>; keep?: boolean };
type TableSpec = {
  layout: "byFinding" | "rows";
  findingField?: string;
  countField?: string;
  nested?: string;
  vertical?: string;
  labelField?: string;
  namesField?: string;
  ranges?: { min: string; max: string; label: Record<InfraLanguage, string> }[];
  totals?: { field: string; label: Record<InfraLanguage, string> }[];
  columns: TableColumn[];
};
const col = (field: string, korean: string, english: string, keep = false): TableColumn => ({ field, header: { Korean: korean, English: english }, keep });
const total = (field: string, korean: string, english: string) => ({ field, label: { Korean: korean, English: english } });

const TABLES: Record<InfraQueryName, TableSpec> = {
  k8s_cluster_cpu: {
    layout: "byFinding", findingField: "finding", countField: "count_clusters_with_finding", vertical: "k8s.cluster.name",
    columns: [
      col("avg_node_count", "현재 노드 수", "Nodes now"),
      col("p95_cpu_allocatable_mcores", "할당 가능 CPU (mcores)", "Allocatable CPU (mcores)"),
      col("cpu_allocatable_per_node_mcores", "노드당 할당 가능 CPU (mcores)", "Allocatable CPU per node (mcores)"),
      col("p95_cpu_requests_mcores", "CPU 요청 (mcores)", "CPU requests (mcores)"),
      col("requests_percent_of_allocatable", "요청 / 할당 가능 (%)", "Requests / allocatable (%)"),
      col("p95_cpu_usage_mcores", "CPU 사용량 (mcores)", "CPU usage (mcores)"),
      col("usage_percent_of_allocatable", "사용량 / 할당 가능 (%)", "Usage / allocatable (%)"),
      col("p95_cpu_limits_mcores", "CPU 제한 (mcores)", "CPU limits (mcores)"),
      col("nodes_needed_for_cpu", "CPU 기준 필요 노드", "Nodes needed for CPU"),
      col("nodes_needed_for_memory", "메모리 기준 필요 노드", "Nodes needed for memory"),
      col("minimum_nodes", "최소 노드 수", "Minimum nodes"),
      col("binding_resource", "최소 노드 수를 정한 자원", "Resource that sets the minimum"),
      col("removable_nodes", "줄일 수 있는 노드", "Nodes that can go"),
      col("cloudType", "클라우드 유형", "Cloud type"),
      col("instanceType", "인스턴스 유형", "Instance type"),
    ],
  },
  k8s_cluster_memory: {
    layout: "rows", vertical: "k8s.cluster.name",
    columns: [
      col("avg_node_count", "현재 노드 수", "Nodes now"),
      col("p95_mem_allocatable_gib", "할당 가능 메모리 (GiB)", "Allocatable memory (GiB)"),
      col("mem_allocatable_per_node_gib", "노드당 할당 가능 메모리 (GiB)", "Allocatable memory per node (GiB)"),
      col("p95_mem_requests_gib", "메모리 요청 (GiB)", "Memory requests (GiB)"),
      col("requests_percent_of_allocatable", "요청 / 할당 가능 (%)", "Requests / allocatable (%)"),
      col("p95_mem_usage_gib", "메모리 사용량 (GiB)", "Memory usage (GiB)"),
      col("usage_percent_of_allocatable", "사용량 / 할당 가능 (%)", "Usage / allocatable (%)"),
      col("p95_mem_limits_gib", "메모리 제한 (GiB)", "Memory limits (GiB)"),
      col("nodes_needed_for_memory", "메모리 기준 필요 노드", "Nodes needed for memory"),
    ],
  },
  k8s_workload_cpu: {
    layout: "byFinding", nested: "findings", findingField: "finding", countField: "count_workloads_with_finding", namesField: "sample_names",
    totals: [total("total_workloads", "전체 워크로드", "Workloads in total"), total("analyzed_workloads", "분석한 워크로드", "Workloads analyzed"), total("excluded_workloads", "제외한 워크로드 (컨트롤러 없는 Pod·정적 Pod)", "Workloads left out (no controller, static pods)")],
    columns: [
      col("k8s.cluster.name", "클러스터", "Cluster"),
      col("k8s.workload.name", "워크로드", "Workload"),
      col("pods", "Pod 수", "Pods"),
      col("containers", "컨테이너", "Containers"),
      col("p95_cpu_usage_mcores", "Pod당 사용량 (mcores)", "Usage per pod (mcores)"),
      col("p95_cpu_requests_mcores", "Pod당 요청 (mcores)", "Requests per pod (mcores)"),
      col("p95_cpu_limits_mcores", "Pod당 제한 (mcores)", "Limits per pod (mcores)"),
      col("limits_partial", "제한 일부 미설정", "Limits partly unset"),
      col("throttling_p95", "스로틀링 지표", "Throttling indicator"),
      col("recommended_request_mcores", "권장 요청 (mcores)", "Recommended requests (mcores)", true),
      col("recommended_limit_mcores", "권장 제한 (mcores)", "Recommended limits (mcores)", true),
    ],
  },
  k8s_workload_memory: {
    layout: "byFinding", nested: "findings", findingField: "finding", countField: "count_workloads_with_finding", namesField: "sample_names",
    totals: [total("total_workloads", "전체 워크로드", "Workloads in total"), total("analyzed_workloads", "분석한 워크로드", "Workloads analyzed"), total("excluded_workloads", "제외한 워크로드 (컨트롤러 없는 Pod·정적 Pod)", "Workloads left out (no controller, static pods)")],
    columns: [
      col("k8s.cluster.name", "클러스터", "Cluster"),
      col("k8s.workload.name", "워크로드", "Workload"),
      col("pods", "Pod 수", "Pods"),
      col("containers", "컨테이너", "Containers"),
      col("p95_working_set_mib", "Pod당 사용량 (MiB)", "Working set per pod (MiB)"),
      col("p95_requests_mib", "Pod당 요청 (MiB)", "Requests per pod (MiB)"),
      col("p95_limits_mib", "Pod당 제한 (MiB)", "Limits per pod (MiB)"),
      col("limits_partial", "제한 일부 미설정", "Limits partly unset"),
      col("sum_oom_kills", "OOMKill", "OOM kills"),
      col("recommended_request_mib", "권장 요청 (MiB)", "Recommended requests (MiB)", true),
      col("recommended_limit_mib", "권장 제한 (MiB)", "Recommended limits (MiB)", true),
    ],
  },
  k8s_rightsizing: {
    layout: "rows", vertical: "k8s.cluster.name",
    columns: [
      col("avg_node_count", "현재 노드 수", "Nodes now"),
      col("analyzed_cpu_requests_percent", "분석한 워크로드의 CPU 요청 비중 (%)", "Share of CPU requests in analyzed workloads (%)"),
      col("analyzed_mem_requests_percent", "분석한 워크로드의 메모리 요청 비중 (%)", "Share of memory requests in analyzed workloads (%)"),
      col("excluded_names", "제외된 Pod (일부)", "Pods left out (some)"),
      col("cpu_requests_now_mcores", "CPU 요청 현재 (mcores)", "CPU requests now (mcores)"),
      col("cpu_requests_change_mcores", "CPU 요청 변화 (mcores)", "CPU requests change (mcores)"),
      col("cpu_requests_after_mcores", "CPU 요청 최적화 후 (mcores)", "CPU requests after (mcores)"),
      col("nodes_needed_after_for_cpu", "최적화 후 CPU 기준 필요 노드", "Nodes needed for CPU after"),
      col("mem_requests_now_gib", "메모리 요청 현재 (GiB)", "Memory requests now (GiB)"),
      col("mem_requests_change_gib", "메모리 요청 변화 (GiB)", "Memory requests change (GiB)"),
      col("mem_requests_after_gib", "메모리 요청 최적화 후 (GiB)", "Memory requests after (GiB)"),
      col("nodes_needed_after_for_memory", "최적화 후 메모리 기준 필요 노드", "Nodes needed for memory after"),
      col("minimum_nodes_after", "최적화 후 최소 노드 수", "Minimum nodes after"),
      col("removable_nodes_after", "최적화 후 줄일 수 있는 노드", "Nodes that can go after"),
    ],
  },
  host_utilization: {
    layout: "byFinding", nested: "utilization_groups", findingField: "utilization", countField: "count", labelField: "k8s_cluster",
    ranges: [
      { min: "cpu_p90_min_percent", max: "cpu_p90_max_percent", label: { Korean: "CPU p90 범위 (%)", English: "CPU p90 range (%)" } },
      { min: "mem_p90_min_percent", max: "mem_p90_max_percent", label: { Korean: "메모리 p90 범위 (%)", English: "Memory p90 range (%)" } },
    ],
    totals: [total("total_hosts", "전체 호스트", "Hosts in total")],
    columns: [
      col("dt.entity.host.name", "호스트", "Host"),
      col("cpu_p90_percent", "CPU p90 (%)", "CPU p90 (%)"),
      col("mem_p90_percent", "메모리 p90 (%)", "Memory p90 (%)"),
      col("k8s_cluster", "Kubernetes 클러스터", "Kubernetes cluster"),
      col("cloudType", "클라우드 유형", "Cloud type"),
      col("instanceType", "인스턴스 유형", "Instance type"),
    ],
  },
  disk_overutilized: {
    layout: "rows", nested: "examples",
    totals: [total("count", "디스크 수", "Disks")],
    columns: [
      col("dt.entity.host.name", "호스트", "Host"),
      col("dt.entity.disk.name", "디스크", "Disk"),
      col("disk_size_gib", "크기 (GiB)", "Size (GiB)"),
      col("used_gib", "평균 사용량 (GiB)", "Average use (GiB)"),
      col("never_used_gib", "최소 여유 공간 (GiB)", "Least free space (GiB)"),
      col("max_disk_percent", "최대 사용률 (%)", "Peak use (%)"),
      col("p90_disk_percent", "p90 사용률 (%)", "p90 use (%)"),
    ],
  },
  disk_underutilized: {
    layout: "rows", nested: "groups",
    totals: [total("disk_count", "디스크 수", "Disks"), total("group_count", "그룹 수", "Groups"), total("total_reclaimable_gib", "회수 가능 합계 (GiB)", "Reclaimable in total (GiB)")],
    columns: [
      col("mount", "마운트", "Mount"),
      col("disk_size_gib", "크기 (GiB)", "Size (GiB)"),
      col("disks", "디스크 수", "Disks"),
      col("hosts", "호스트 (일부)", "Hosts (some)"),
      col("max_used_gib", "30일 최대 사용량 (GiB)", "30-day peak use (GiB)"),
      col("max_disk_percent", "최대 사용률 (%)", "Peak use (%)"),
      col("recommended_size_gib", "권장 크기 (GiB)", "Recommended size (GiB)"),
      col("reclaimable_gib", "회수 가능 (GiB)", "Reclaimable (GiB)"),
    ],
  },
  network_saturated_interfaces: {
    layout: "rows",
    columns: [
      col("network_area", "네트워크 영역", "Network area"),
      col("device", "장비", "Device"),
      col("interface", "인터페이스", "Interface"),
      col("ifcSaturation", "포화도 (p95, 1 = 100%)", "Saturation (p95, 1 = 100%)"),
      col("p95_traffic_bps", "p95 트래픽 (bps)", "p95 traffic (bps)"),
    ],
  },
  network_updown_interfaces: {
    layout: "rows",
    columns: [
      col("network_area", "네트워크 영역", "Network area"),
      col("parentDeviceName", "장비", "Device"),
      col("ifAdminStatus", "관리 상태", "Admin status"),
      col("ifOperStatus", "동작 상태", "Operational status"),
      col("type", "유형", "Type"),
    ],
  },
};

/** Finding names in the tables, in the order they are shown - risks first. */
const FINDINGS: [string, string, string][] = [
  ["OOM_KILLS", "OOMKill 발생", "OOM kills"],
  ["INCREASE_LIMITS", "제한 증가 필요", "Increase limits"],
  ["NO_LIMIT_SET", "제한 미설정", "No limit set"],
  ["NO_REQUESTS_SET", "요청 미설정", "No requests set"],
  ["INCREASE_REQUESTS", "요청 증가 필요", "Increase requests"],
  ["SCALE_UP", "확장 필요", "Scale up"],
  ["UNDERPROVISIONED", "과소 프로비저닝", "Under-provisioned"],
  ["REDUCE_REQUESTS", "요청 감소 가능", "Reduce requests"],
  ["REDUCE_LIMITS", "제한 감소 가능", "Reduce limits"],
  ["SCALE_DOWN", "축소 가능", "Scale down"],
  ["OVERPROVISIONED", "과다 프로비저닝", "Over-provisioned"],
  ["UNUSED", "미사용 추정", "Possibly unused"],
  ["NOMINAL", "정상", "Nominal"],
  ["KUBERNETES_NODE", "Kubernetes 노드 (클러스터 섹션 참고)", "Kubernetes nodes (see the cluster section)"],
  ["NOT_REPORTING", "24시간 데이터 없음 (교체·종료 추정)", "No data for 24 h (replaced or stopped)"],
  ["EXCLUDED_NO_CONTROLLER", "제외 (컨트롤러 없는 Pod)", "Left out (no controller)"],
  ["EXCLUDED_STATIC_POD", "제외 (정적 Pod)", "Left out (static pods)"],
];

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
// First and last: after the data rules grew (v11), a language line only at the end was lost and the
// Kubernetes and disk reports came back in English (diw85600 test run, 2026-11-15).
const withLanguage = (instruction: string) => (instruction ? `${LANGUAGE_LINE}\n${instruction}\n${LANGUAGE_LINE}` : LANGUAGE_LINE);

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

// Every query starts at once: since v20 no AI report sits between the domains to spread out.
const query = (name: InfraQueryName, domain: InfraDomain, position: { x: number; y: number }): TaskDefinition => ({
  action: "dynatrace.automations:execute-dql-query",
  description: QUERY_TITLES[name].English,
  input: { query: INFRA_QUERIES[name] },
  position,
  predecessors: [],
  conditions: { states: {}, custom: `{{ ${inScope(domain)} }}`, else: "SKIP" },
});

/**
 * The action's field limits, as the Workflows editor states them (2026-11-15): prompt 10,000
 * characters, instructions 2,500, additional context 100,000 - the documentation's 5,000 and 20,000
 * are older. With auto-trim on, a longer field is cut without an error - v7 to v13 sent 3,853 to
 * 4,437 characters of instructions, so part of the data rules likely never reached the AI. The data
 * rules therefore go in the prompt, the instructions keep the language line and a few lines, and
 * building the template fails when either field is over its limit.
 */
const PROMPT_LIMIT = 10000;
const INSTRUCTION_LIMIT = 2500;
/** A field's length once the workflow renders its language expression - the longer branch. */
const renderedLength = (text: string) =>
  text.replace(/\{\{ "([^"]*)" if [^}]*? else "([^"]*)" \}\}/g, (_match, english: string, korean: string) => (english.length > korean.length ? english : korean)).length;
const promptInput = (prompt: string, instruction: string, supplementary: string) => {
  const promptLength = renderedLength(prompt);
  const instructionLength = renderedLength(instruction);
  if (promptLength > PROMPT_LIMIT || instructionLength > INSTRUCTION_LIMIT) {
    throw new Error(`Prompt task over its limits: prompt ${promptLength}/${PROMPT_LIMIT}, instructions ${instructionLength}/${INSTRUCTION_LIMIT}`);
  }
  return { config: "disabled", autoTrim: true, prompt, instruction, supplementary };
};

/**
 * The key actions on top of the notebook and the email. The AI reads no raw data and no reports: the
 * rank_actions script hands it the candidates, risks first, each with its item and numbers, and it
 * picks and words a few. The numbers it writes are still checked against the data (checkNumbers), and
 * without its answer the scripts show the first candidates as they are.
 */
const ANY_SCOPE = INFRA_DOMAINS.map(inScope).join(" or ");
const SUMMARY_DATA = `{{ result("${RANK_TASK}")["candidates"] | default("") }}`;
const SUMMARY_PROMPT = `Below are candidate actions from an infrastructure optimization run, already ranked: risks first, then savings. Each starts with its domain in brackets and gives the item, what was measured and the change, with its numbers.
Write the key actions: 3 to 5 bullet points chosen from the candidates, keeping their order and covering different domains where the list allows. Each bullet restates one candidate in one plain sentence: the item (with its cluster in parentheses where the candidate gives one), the change, and the candidate's numbers exactly as written.`;
const SUMMARY_INSTRUCTION = [
  "Start directly with the first bullet - no title, no introduction and no closing line.",
  "Use only the candidates: no other facts, causes or advice, no number of your own, never add numbers up, and never move a number from one item to another. Keep each value with its unit as written; the throttling indicator has no unit.",
  "Keep any caveat a candidate gives (after its last dash) in the bullet. Keep the candidate's own words for what a finding means. Never write money amounts, prices or saving percentages.",
  "A candidate that counts workloads across all clusters names no cluster: never give it one, and call them workloads, not pods.",
].join("\n");

/**
 * The part the notebook, the email and rank_actions share: the run's input, the time, each in-scope
 * domain's query results, the report written from them (REPORT_WRITER) and their data tables. Both
 * deliveries then name the same domains in their title or subject.
 */
const collectReports = () => {
  const domains = INFRA_DOMAINS.map((domain) => ({
    domain,
    title: DOMAINS[domain].title,
    short: DOMAINS[domain].short,
    period: DOMAINS[domain].period,
    queries: DOMAINS[domain].queries.map((name) => ({ name, title: QUERY_TITLES[name], query: INFRA_QUERIES[name], table: { ...TABLES[name], meaningKind: MEANING_KINDS[name] ?? null, note: TABLE_NOTES[name] } })),
  }));
  return `const DOMAINS = ${JSON.stringify(domains, null, 2)};
const FINDINGS = ${JSON.stringify(FINDINGS)};
const NL = String.fromCharCode(10);
// Rows drawn per table at most; network up/down lists can be long.
const MAX_ROWS = 20;

// Numbers with thousands separators, as the query gave them (no rounding here).
const groupDigits = (value) => {
  const [whole, fraction] = String(Math.abs(value)).split(".");
  let rest = whole;
  let out = "";
  while (rest.length > 3) {
    out = "," + rest.slice(-3) + out;
    rest = rest.slice(0, -3);
  }
  return (value < 0 ? "-" : "") + rest + out + (fraction ? "." + fraction : "");
};
const cell = (value, keep, text) => {
  if (value === null || value === undefined || value === "") return keep ? text.keep : "-";
  if (typeof value === "boolean") return value ? text.yes : text.no;
  if (Array.isArray(value)) return value.map((item) => cell(item, false, text)).join(", ");
  if (typeof value === "number") return groupDigits(value);
  if (typeof value === "string" && /^-?[0-9]+(\\.[0-9]+)?$/.test(value)) return groupDigits(Number(value));
  if (typeof value === "object") return JSON.stringify(value).split("|").join("/");
  return String(value).split("|").join("/").split(NL).join(" ");
};
const findingLabel = (finding, language) => {
  const entry = FINDINGS.find((item) => item[0] === finding);
  return entry ? (language === "English" ? entry[2] : entry[1]) : String(finding);
};
const findingRank = (finding) => {
  const index = FINDINGS.findIndex((item) => item[0] === finding);
  return index < 0 ? FINDINGS.length : index;
};
const table = (columns, rows, language, text) => {
  const head = "| " + columns.map((column) => column.header[language]).join(" | ") + " |";
  const rule = "|" + columns.map(() => "---").join("|") + "|";
  const body = rows.slice(0, MAX_ROWS).map((row) => "| " + columns.map((column) => cell(row[column.field], column.keep, text)).join(" | ") + " |");
  const more = rows.length > MAX_ROWS ? NL + NL + "_" + text.more(rows.length - MAX_ROWS) + "_" : "";
  return [head, rule, ...body].join(NL) + more;
};
// One two-column table per row, for records with many figures (clusters).
const verticalTable = (columns, row, language, text) => {
  const head = "| " + text.item + " | " + text.value + " |";
  const body = columns.map((column) => "| " + column.header[language] + " | " + cell(row[column.field], column.keep, text) + " |");
  return [head, "|---|---|", ...body].join(NL);
};

/** A query's data as markdown tables (see TABLES in the template source), or a note without data. */
const renderData = (spec, records, language, text) => {
  if (!Array.isArray(records)) return "_" + text.noData + "_";
  const first = records[0] ?? {};
  const parts = [];
  if (spec.note) parts.push("_" + spec.note[language] + "_");
  if (spec.totals) parts.push(spec.totals.map((item) => "**" + item.label[language] + ":** " + cell(first[item.field], false, text)).join(" · "));
  if (spec.layout === "rows") {
    const rows = spec.nested ? (Array.isArray(first[spec.nested]) ? first[spec.nested] : []) : records;
    const drawn = spec.vertical
      ? rows.slice(0, MAX_ROWS).map((row) => "**" + cell(row[spec.vertical], false, text) + "**" + NL + NL + verticalTable(spec.columns, row, language, text)).join(NL + NL)
      : table(spec.columns, rows, language, text);
    parts.push(rows.length > 0 ? drawn : "_" + text.none + "_");
    return parts.join(NL + NL);
  }
  const groups = (spec.nested ? (Array.isArray(first[spec.nested]) ? first[spec.nested] : []) : records).slice();
  groups.sort((a, b) => findingRank(a[spec.findingField]) - findingRank(b[spec.findingField]));
  const countOnly = [];
  for (const group of groups) {
    const label = findingLabel(group[spec.findingField], language) + (spec.labelField && group[spec.labelField] ? " - " + cell(group[spec.labelField], false, text) : "");
    const ranges = (spec.ranges ?? []).map((range) => range.label[language] + ": " + (cell(group[range.min], false, text) === cell(group[range.max], false, text) ? cell(group[range.min], false, text) : cell(group[range.min], false, text) + "~" + cell(group[range.max], false, text))).join(" · ");
    const count = group[spec.countField];
    const examples = Array.isArray(group.examples) ? group.examples : [];
    // What the finding means and what to change - fixed sentences (infraReportText.ts), not the AI's.
    const meaning = spec.meaningKind ? MEANINGS[spec.meaningKind + " " + group[spec.findingField]] ?? MEANINGS["workload " + group[spec.findingField]] : null;
    if (examples.length === 0) {
      const names = spec.namesField && Array.isArray(group[spec.namesField]) && group[spec.namesField].length > 0 ? " - " + text.forExample + " " + cell(group[spec.namesField], false, text) : "";
      countOnly.push("- " + label + ": " + cell(count, false, text) + text.count + (ranges ? " (" + ranges + ")" : "") + names + (meaning ? " - " + meaning[language] : ""));
      continue;
    }
    const tables = spec.vertical
      ? examples.map((row) => "**" + cell(row[spec.vertical], false, text) + "**" + NL + NL + verticalTable(spec.columns, row, language, text)).join(NL + NL)
      : table(spec.columns, examples, language, text);
    const sample = Number(count) > examples.length ? NL + NL + "_" + text.sample(examples.length, cell(count, false, text)) + "_" : "";
    parts.push("**" + label + " · " + cell(count, false, text) + text.count + "**" + (meaning ? NL + NL + meaning[language] : "") + (ranges ? NL + NL + ranges : "") + NL + NL + tables + sample);
  }
  if (groups.length === 0) parts.push("_" + text.none + "_");
  if (countOnly.length > 0) parts.push(countOnly.join(NL));
  return parts.join(NL + NL);
};

// ---- Number check: every number the AI writes must be in the data it was given ----------------
// The text is the AI's, the tables are not; a number in the text that no query returned was computed,
// guessed or moved from another item (notebook 3869dd80: "throttling 20,414 mcores" on the wrong
// workload, "311 workloads" for 94). Such numbers get a mark and are listed under the report.

// Every number in the records, also rounded the ways a text writes them (12.0 -> 12, 7829.43 -> 7829.4),
// kept per kind of value as its field name says - so "11 mcores" is not taken for an 11 % CPU p90,
// and "77 workloads" not for a 77 MiB working set (notebooks b650889b, d63e5204).
const newKnown = () => ({ any: new Set(), percent: new Set(), mcores: new Set(), mib: new Set(), gib: new Set(), count: new Set(), score: new Set() });
const kindOfField = (field) => {
  const name = String(field ?? "").toLowerCase();
  if (name.includes("throttling")) return "score";
  if (name.includes("percent")) return "percent";
  if (name.includes("mcores")) return "mcores";
  if (name.endsWith("_mib") || name.endsWith("mib")) return "mib";
  if (name.includes("_gib") || name.endsWith("gib")) return "gib";
  if (["count", "workloads", "nodes", "disks", "containers", "oom", "hosts"].some((part) => name.includes(part))) return "count";
  return null;
};
const collectNumbers = (value, into, field) => {
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, into, field);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) collectNumbers(item, into, key);
  } else {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (Number.isFinite(number)) {
      const kind = kindOfField(field);
      for (const form of [number, Math.round(number), Math.round(number * 10) / 10, Math.round(number * 100) / 100]) {
        into.any.add(String(Math.abs(form)));
        if (kind) into[kind].add(String(Math.abs(form)));
      }
    }
  }
  return into;
};
// Numbers the rules themselves name (thresholds, floors, factors), per kind; small ones (list items,
// a few of something) pass everywhere.
const ALLOWED = {
  any: ["7", "15", "20", "30", "40", "50", "64", "80", "85", "90", "95", "99", "100", "120", "125", "130", "150", "200", "0.4", "0.85", "0.9", "1.2", "1.25", "1.3", "1.5", "2.5"],
  percent: ["30", "40", "50", "80", "85", "90", "95", "100", "120", "125", "130", "150"],
  mcores: ["50", "100"],
  mib: ["16", "64"],
  gib: ["20", "50"],
  count: [],
  score: [],
};
const isAllowed = (kind, value) => (Number.isInteger(Number(value)) && Number(value) <= 10) || ALLOWED[kind].includes(value);
// The kind a unit after a number names; a name made of other letters makes the number part of a name.
const UNIT_KINDS = { mcores: "mcores", mcore: "mcores", m: "mcores", MiB: "mib", Mi: "mib", MB: "mib", GiB: "gib", Gi: "gib", GB: "gib", TiB: "gib", TB: "gib", bps: "any", ms: "any", x: "any" };
const COUNT_WORDS = ["workloads", "workload", "nodes", "node", "hosts", "host", "disks", "disk", "clusters", "cluster", "pods", "pod", "containers", "groups"];
// Korean counters right after a number: pieces, cases, machines, places, times.
const COUNTERS = ["개", "건", "대", "곳", "회"];
const isDigit = (char) => char >= "0" && char <= "9";
const isLetter = (char) => !!char && ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z"));
const RANGE_MARKS = ["-", "~", "–"];
// A token: letters, digits and the marks names and numbers are written with. A number inside a token
// that also holds letters (other than a trailing unit) is part of a name or id - loki-ingester-0,
// e2-standard-4, m5.large, p95, ip-172-31-12-251.ap-northeast-2 - while 40-60% and 3,500mcores are
// numbers.
const inToken = (char) => !!char && (isLetter(char) || isDigit(char) || "._-/:~–,%".includes(char));
const isNameToken = (token) => {
  let rest = token;
  while (rest && "._-/:~–,%".includes(rest[rest.length - 1])) rest = rest.slice(0, -1);
  let end = rest.length;
  while (end > 0 && isLetter(rest[end - 1])) end--;
  if (rest.slice(end) in UNIT_KINDS) rest = rest.slice(0, end);
  for (const char of rest) if (isLetter(char)) return true;
  return false;
};

/** The text with unverified numbers marked, and the list of them. Code spans and link targets are skipped. */
const checkNumbers = (report, known, text) => {
  let out = "";
  let inCode = false;
  const flagged = [];
  let i = 0;
  while (i < report.length) {
    const char = report[i];
    if (char === "\x60") {
      inCode = !inCode;
      out += char;
      i++;
      continue;
    }
    if (!inCode && char === "]" && report[i + 1] === "(") {
      const close = report.indexOf(")", i);
      const end = close < 0 ? report.length : close + 1;
      out += report.slice(i, end);
      i = end;
      continue;
    }
    if (inCode || !isDigit(char)) {
      out += char;
      i++;
      continue;
    }
    let tokenStart = i;
    while (tokenStart > 0 && inToken(report[tokenStart - 1])) tokenStart--;
    let tokenEnd = i;
    while (tokenEnd < report.length && inToken(report[tokenEnd])) tokenEnd++;
    if (isNameToken(report.slice(tokenStart, tokenEnd))) {
      out += report.slice(i, tokenEnd);
      i = tokenEnd;
      continue;
    }
    // The number: digits with thousands commas, then a fraction.
    let j = i;
    while (j < report.length && (isDigit(report[j]) || (report[j] === "," && isDigit(report[j + 1]) && isDigit(report[j + 2]) && isDigit(report[j + 3]) && !isDigit(report[j + 4])))) j++;
    if (report[j] === "." && isDigit(report[j + 1])) {
      j++;
      while (j < report.length && isDigit(report[j])) j++;
    }
    // Letters stuck to it: a unit, or else the number is part of a name.
    let k = j;
    while (isLetter(report[k])) k++;
    const stuck = report.slice(j, k);
    const raw = report.slice(i, j);
    const partOfName = (stuck && !(stuck in UNIT_KINDS)) || (report[j] === "-" && isLetter(report[j + 1])) || (report[j] === "_" && (isLetter(report[j + 1]) || isDigit(report[j + 1])));
    // The unit: stuck letters, a percent sign or Korean counter, or a word after one space. The first
    // number of a range (11~19 mcores) takes the unit after the range's last number.
    let u = j;
    if (!stuck && RANGE_MARKS.includes(report[u]) && isDigit(report[u + 1])) {
      u++;
      while (u < report.length && (isDigit(report[u]) || report[u] === "," || report[u] === ".")) u++;
    }
    let w = u;
    while (isLetter(report[w])) w++;
    const unit = stuck || report.slice(u, w);
    let kind = "any";
    if (unit) {
      kind = UNIT_KINDS[unit] ?? "any";
    } else if (report[u] === "%") {
      kind = "percent";
    } else if (COUNTERS.includes(report[u])) {
      kind = "count";
    } else if (report[u] === " ") {
      let v = u + 1;
      while (isLetter(report[v])) v++;
      const word = report.slice(u + 1, v);
      if (word in UNIT_KINDS) kind = UNIT_KINDS[word];
      else if (COUNT_WORDS.includes(word)) kind = "count";
    }
    const value = String(Number(raw.split(",").join("")));
    if (partOfName || isAllowed(kind, value) || known[kind].has(value)) {
      out += report.slice(i, k);
    } else {
      out += report.slice(i, k) + "⚠";
      if (!flagged.includes(raw)) flagged.push(raw);
    }
    i = k;
  }
  if (flagged.length === 0) return { text: report, flagged };
  const listed = flagged.slice(0, 12).join(", ") + (flagged.length > 12 ? " " + text.more(flagged.length - 12) : "");
  return { text: out + NL + NL + "> ⚠ " + text.unverified + listed, flagged };
};

// ---- Data check: query results that contradict each other point at a query bug, not a finding ----
// Each rule below once failed silently in a report (v15-v18): a sum that made unset limits 0, a
// "reduce" recommendation above the current value, a node count the two cluster queries disagreed on.
// The scripts show what fails above the tables; npm run test:infra runs the same check on saved results.
const num = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
const firstNested = (records, field) => (Array.isArray(records) && records[0] && Array.isArray(records[0][field]) ? records[0][field] : []);
const examplesOf = (records) => (Array.isArray(records) ? records.flatMap((group) => (Array.isArray(group.examples) ? group.examples : [])) : []);
const WORKLOAD_FIELDS = {
  k8s_workload_cpu: { request: "p95_cpu_requests_mcores", limit: "p95_cpu_limits_mcores", recRequest: "recommended_request_mcores", recLimit: "recommended_limit_mcores", unit: "mcores" },
  k8s_workload_memory: { request: "p95_requests_mib", limit: "p95_limits_mib", recRequest: "recommended_request_mib", recLimit: "recommended_limit_mib", unit: "MiB" },
};
const RAISING_REQUESTS = ["INCREASE_REQUESTS", "NO_REQUESTS_SET"];
const RAISING_LIMITS = ["INCREASE_LIMITS", "OOM_KILLS", "NO_LIMIT_SET"];
const hostClass = (cpu, memory) => (cpu < 10 && memory < 30 ? "UNUSED" : cpu < 30 && memory < 50 ? "OVERPROVISIONED" : cpu > 80 && memory < 85 ? "UNDERPROVISIONED" : "NOMINAL");

/** Every contradiction in one domain's query results (byName: query name -> records), as text lines. */
const checkData = (byName) => {
  const issues = [];
  const add = (query, item, problem) => issues.push(query + " · " + item + ": " + problem);

  for (const [name, fields] of Object.entries(WORKLOAD_FIELDS)) {
    const records = byName[name];
    if (!Array.isArray(records) || !records[0]) continue;
    const top = records[0];
    const findings = firstNested(records, "findings");
    const total = num(top.total_workloads);
    const sum = findings.reduce((acc, group) => acc + (num(group.count_workloads_with_finding) ?? 0), 0);
    if (total !== sum) add(name, "total_workloads", "the findings add up to " + sum + ", not " + total);
    if (num(top.analyzed_workloads) + num(top.excluded_workloads) !== total) add(name, "analyzed_workloads", "analyzed + left out is not the total");
    for (const group of findings) {
      const finding = String(group.finding);
      if (findingRank(finding) >= FINDINGS.length) add(name, finding, "unknown finding");
      for (const row of Array.isArray(group.examples) ? group.examples : []) {
        const item = row["k8s.workload.name"] + " (" + row["k8s.cluster.name"] + ")";
        const request = num(row[fields.request]);
        const limit = num(row[fields.limit]);
        const recRequest = num(row[fields.recRequest]);
        const recLimit = num(row[fields.recLimit]);
        const partial = row.limits_partial === true;
        if (request === 0 || limit === 0) add(name, item, "a request or limit of 0 - one not set must be null");
        if (finding.startsWith("EXCLUDED") && (recRequest !== null || recLimit !== null)) add(name, item, "advice for a workload left out");
        if (RAISING_REQUESTS.includes(finding) && !(recRequest !== null && (request === null || recRequest > request))) add(name, item, finding + " without a higher recommended request");
        if (finding === "REDUCE_REQUESTS" && !(recRequest !== null && request !== null && recRequest < request)) add(name, item, "REDUCE_REQUESTS without a lower recommended request");
        if (finding === "REDUCE_LIMITS" && !(recLimit !== null && limit !== null && recLimit < limit)) add(name, item, "REDUCE_LIMITS without a lower recommended limit");
        if (RAISING_LIMITS.includes(finding) && !partial && !(recLimit !== null && (limit === null || recLimit > limit))) add(name, item, finding + " without a higher recommended limit");
        if (partial && recLimit !== null) add(name, item, "limit advice although not every container sets a limit");
        const newRequest = recRequest ?? request;
        const newLimit = recLimit ?? limit;
        if (!partial && newRequest !== null && newLimit !== null && newRequest > newLimit) add(name, item, "the request would end above the limit (" + newRequest + " > " + newLimit + " " + fields.unit + ")");
      }
    }
  }

  const clusters = examplesOf(byName.k8s_cluster_cpu);
  for (const row of clusters) {
    const item = String(row["k8s.cluster.name"]);
    const nodes = num(row.avg_node_count);
    const minimum = num(row.minimum_nodes);
    const removable = num(row.removable_nodes);
    if (minimum !== Math.max(num(row.nodes_needed_for_cpu) ?? 0, num(row.nodes_needed_for_memory) ?? 0)) add("k8s_cluster_cpu", item, "minimum_nodes is not the larger of the CPU and memory node counts");
    if (removable !== Math.max(Math.floor(nodes - minimum), 0)) add("k8s_cluster_cpu", item, "removable_nodes does not follow from the node counts");
    const expected = minimum > nodes ? "SCALE_UP" : removable > 0 ? "SCALE_DOWN" : "NOMINAL";
    if (row.finding !== expected) add("k8s_cluster_cpu", item, "finding " + row.finding + " where the node counts say " + expected);
  }
  for (const row of Array.isArray(byName.k8s_cluster_memory) ? byName.k8s_cluster_memory : []) {
    const item = String(row["k8s.cluster.name"]);
    const cpu = clusters.find((entry) => entry["k8s.cluster.name"] === row["k8s.cluster.name"]);
    if (cpu && num(cpu.nodes_needed_for_memory) !== num(row.nodes_needed_for_memory)) add("k8s_cluster_memory", item, "memory needs " + row.nodes_needed_for_memory + " nodes here and " + cpu.nodes_needed_for_memory + " in the CPU query");
  }
  for (const row of Array.isArray(byName.k8s_rightsizing) ? byName.k8s_rightsizing : []) {
    const item = String(row["k8s.cluster.name"]);
    if (num(row.cpu_requests_now_mcores) + num(row.cpu_requests_change_mcores) !== num(row.cpu_requests_after_mcores)) add("k8s_rightsizing", item, "CPU requests now + change is not the value after");
    if (Math.abs(num(row.mem_requests_now_gib) + num(row.mem_requests_change_gib) - num(row.mem_requests_after_gib)) > 0.11) add("k8s_rightsizing", item, "memory requests now + change is not the value after");
    for (const field of ["analyzed_cpu_requests_percent", "analyzed_mem_requests_percent"]) {
      const share = num(row[field]);
      if (share !== null && (share < 0 || share > 101)) add("k8s_rightsizing", item, field + " is " + share);
    }
    const minimum = num(row.minimum_nodes_after);
    if (minimum !== Math.max(num(row.nodes_needed_after_for_cpu) ?? 0, num(row.nodes_needed_after_for_memory) ?? 0)) add("k8s_rightsizing", item, "minimum_nodes_after is not the larger of the node counts after");
    if (num(row.removable_nodes_after) !== Math.max(Math.floor(num(row.avg_node_count) - minimum), 0)) add("k8s_rightsizing", item, "removable_nodes_after does not follow from the node counts");
    const cpu = clusters.find((entry) => entry["k8s.cluster.name"] === row["k8s.cluster.name"]);
    if (cpu && num(cpu.p95_cpu_requests_mcores) !== num(row.cpu_requests_now_mcores)) add("k8s_rightsizing", item, "CPU requests now differ from the cluster query (" + row.cpu_requests_now_mcores + " / " + cpu.p95_cpu_requests_mcores + ")");
  }

  const hosts = byName.host_utilization;
  if (Array.isArray(hosts) && hosts[0]) {
    const groups = firstNested(hosts, "utilization_groups");
    const sum = groups.reduce((acc, group) => acc + (num(group.count) ?? 0), 0);
    if (sum !== num(hosts[0].total_hosts)) add("host_utilization", "total_hosts", "the groups add up to " + sum + ", not " + hosts[0].total_hosts);
    for (const group of groups) {
      const item = group.utilization + (group.k8s_cluster ? " " + group.k8s_cluster : "");
      if (num(group.cpu_p90_min_percent) > num(group.cpu_p90_max_percent) || num(group.mem_p90_min_percent) > num(group.mem_p90_max_percent)) add("host_utilization", item, "a range runs backwards");
      // Kubernetes nodes and hosts gone quiet are grouped by what they are, not by their values.
      if (group.utilization === "KUBERNETES_NODE" || group.utilization === "NOT_REPORTING") continue;
      for (const row of Array.isArray(group.examples) ? group.examples : []) {
        const own = hostClass(num(row.cpu_p90_percent), num(row.mem_p90_percent));
        if (own !== group.utilization) add("host_utilization", String(row["dt.entity.host.name"]), "in " + group.utilization + " where its values say " + own);
      }
    }
  }

  const disks = byName.disk_underutilized;
  if (Array.isArray(disks) && disks[0]) {
    const groups = Array.isArray(disks[0].groups) ? disks[0].groups : [];
    for (const group of groups) {
      const item = group.mount + " " + group.disk_size_gib + " GiB";
      const size = num(group.disk_size_gib);
      const recommended = num(group.recommended_size_gib);
      const count = num(group.disks);
      if (recommended < num(group.max_used_gib)) add("disk_underutilized", item, "recommended size under the peak use");
      if (recommended >= size) add("disk_underutilized", item, "recommended size not smaller than the disk");
      if (Math.abs((size - recommended) * count - num(group.reclaimable_gib)) > count * 0.6 + 0.1) add("disk_underutilized", item, "reclaimable_gib does not follow from the sizes");
    }
    if (groups.length === num(disks[0].group_count)) {
      const sum = groups.reduce((acc, group) => acc + num(group.reclaimable_gib), 0);
      if (Math.abs(sum - num(disks[0].total_reclaimable_gib)) > 0.1 * groups.length + 0.1) add("disk_underutilized", "total_reclaimable_gib", "the groups add up to " + Math.round(sum * 10) / 10);
      const diskSum = groups.reduce((acc, group) => acc + num(group.disks), 0);
      if (diskSum !== num(disks[0].disk_count)) add("disk_underutilized", "disk_count", "the groups add up to " + diskSum + " disks");
    }
  }
  return issues;
};

${REPORT_WRITER}
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
    footer: "Ops Navigator의 Infrastructure Optimization 워크플로가 생성했습니다. 리포트와 데이터 표는 쿼리 결과로 만들었고, 핵심 요약만 Dynatrace 생성형 AI가 골라 썼습니다. 아래 쿼리로 원본 데이터를 다시 확인할 수 있습니다.",
    mailFooter: "Ops Navigator의 Infrastructure Optimization 워크플로가 보낸 메일입니다. 리포트와 데이터 표는 쿼리 결과로 만들었고, 핵심 요약만 Dynatrace 생성형 AI가 골라 썼습니다. 쿼리는 결과 전달에 노트북을 함께 선택하거나, Workflows 앱의 실행 기록에서 확인할 수 있습니다.",
    mailFooterLinked: "Ops Navigator의 Infrastructure Optimization 워크플로가 보낸 메일입니다. 리포트와 데이터 표는 쿼리 결과로 만들었고, 핵심 요약만 Dynatrace 생성형 AI가 골라 썼습니다. 쿼리는 위 노트북에서 확인할 수 있습니다.",
    notebook: "노트북",
    notebookLink: "원본 데이터 쿼리와 함께 보기",
    summary: "## 핵심 요약",
    tables: "데이터",
    keep: "유지",
    yes: "예",
    no: "아니오",
    item: "항목",
    value: "값",
    count: "개",
    noData: "데이터를 가져오지 못했습니다 (쿼리 실패 또는 미실행).",
    none: "해당 항목이 없습니다.",
    more: (rest) => "외 " + rest + "개는 생략했습니다.",
    sample: (shown, total) => "전체 " + total + "개 중 " + shown + "개 예시입니다.",
    forExample: "예:",
    unverified: "데이터에서 찾지 못한 수치입니다. AI가 계산하거나 추정한 값일 수 있으니 리포트의 표 값으로 확인하세요: ",
    dataCheck: "데이터 점검:",
    dataCheckNote: "쿼리 결과끼리 맞지 않는 값이 있습니다. 쿼리 오류일 수 있으니 해당 항목은 조치 전에 원본 데이터로 확인하세요.",
    summaryFallback: "AI 요약을 받지 못해 우선순위가 높은 후보를 그대로 보여 줍니다.",
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
    footer: "Created by the Infrastructure Optimization workflow of Ops Navigator. The reports and data tables come from the query results; only the key actions are picked and worded by Dynatrace generative AI. The queries below show the data again.",
    mailFooter: "Sent by the Infrastructure Optimization workflow of Ops Navigator. The reports and data tables come from the query results; only the key actions are picked and worded by Dynatrace generative AI. For the queries, also choose notebook delivery, or open the run in the Workflows app.",
    mailFooterLinked: "Sent by the Infrastructure Optimization workflow of Ops Navigator. The reports and data tables come from the query results; only the key actions are picked and worded by Dynatrace generative AI. The queries are in the notebook above.",
    notebook: "Notebook",
    notebookLink: "open with the raw data queries",
    summary: "## Key actions",
    tables: "Data",
    keep: "keep",
    yes: "yes",
    no: "no",
    item: "Item",
    value: "Value",
    count: "",
    noData: "No data (the query failed or did not run).",
    none: "None.",
    more: (rest) => rest + " more not shown.",
    sample: (shown, total) => shown + " examples of " + total + ".",
    forExample: "for example",
    unverified: "Numbers not found in the data - the AI may have computed or estimated them, so check them against the tables: ",
    dataCheck: "Data check:",
    dataCheckNote: "some query results contradict each other. That can be a query error, so check these items against the raw data before acting on them.",
    summaryFallback: "No AI summary came back, so these are the top-ranked candidates as they are.",
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

// The run's input and every in-scope query's records (null: failed, or did not run) - for collect()
// and for rank_actions.
async function gather(execution_id) {
  const execution = await executionsClient.getExecution({ id: execution_id });
  const input = execution.input ?? {};
  const language = input.language === "English" ? "English" : "Korean";
  const scope = input.scope ?? {};
  const covered = DOMAINS.filter((entry) => scope[entry.domain] === true);
  const byName = {};
  for (const entry of covered) {
    for (const item of entry.queries) {
      try {
        const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: item.name });
        byName[item.name] = Array.isArray(task.result?.records) ? task.result.records : null;
      } catch (error) {
        byName[item.name] = null;
      }
    }
  }
  return { language, scope, covered, byName };
}

async function collect(execution_id) {
  const { language, scope, covered, byName } = await gather(execution_id);
  const text = TEXT[language];
  // Korea time, written out by hand: the runtime's Intl time zones are not guaranteed.
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " KST";

  const reports = [];
  // Every number of every query, for checking the AI's key actions, which span the domains.
  const allKnown = newKnown();
  for (const entry of covered) {
    const own = Object.fromEntries(entry.queries.map((item) => [item.name, byName[item.name] ?? null]));
    // The data tables, drawn from each query task's records.
    const data = entry.queries.map((item) => {
      collectNumbers(own[item.name], allKnown);
      return "#### " + item.title[language] + NL + NL + renderData(item.table, own[item.name], language, text);
    });
    // Contradictions between the query results go above the tables, so no one acts on them unseen.
    const issues = checkData(own);
    if (issues.length > 0) data.unshift("> ⚠ **" + text.dataCheck + "** " + text.dataCheckNote + NL + issues.slice(0, 20).map((issue) => "> - " + issue).join(NL) + (issues.length > 20 ? NL + "> - " + text.more(issues.length - 20) : ""));
    // A domain whose every query failed has no report, only its note in the tables.
    const report = entry.queries.some((item) => Array.isArray(own[item.name])) ? writeReport(entry, own, language) : "";
    reports.push({ entry, report, issues, data: "### " + entry.title[language] + " - " + text.tables + NL + NL + data.join(NL + NL) });
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

  // The key actions on top: the AI's pick of the ranked candidates (SUMMARY_TASK), numbers checked;
  // without it, the first candidates as they are. Then the resources line, from the data.
  let summary = "";
  try {
    const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: "${SUMMARY_TASK}" });
    // "•" bullets (diw85600 test run) become a markdown list.
    summary = tidy(String(task.result?.text ?? "")).replace(/^[•●▪] */gm, "- ");
    if (summary) summary = checkNumbers(summary, allKnown, text).text;
  } catch (error) {
    summary = "";
  }
  if (!summary) {
    const candidates = spreadPick(rankActions(byName, language, scope), 5);
    summary = candidates.length > 0 ? candidates.map((line) => "- " + line).join(NL) + NL + NL + "_" + text.summaryFallback + "_" : "";
  }
  const resources = resourcesLine(byName, language, scope);
  if (resources) summary = (summary ? summary + NL + NL : "") + resources;

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

/**
 * The script part the notebook and email tasks share (collectReports), for scripts/infra-check.mjs:
 * it runs the very code the workflow runs on saved query results - renderData, checkData,
 * checkNumbers and collect.
 */
export const infraReportScript = () => collectReports();

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
  for (const { entry, report, data } of reports) {
    // The report brings its own title; the domain heading is only for a missing one.
    sections.push(markdown(report ? report : "## " + entry.title[language] + "\\n\\n" + text.missing));
    sections.push(markdown(data));
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
 * same title the notebook gets as its subject, and the data tables (v11) - the queries stay out: their
 * text made the template's Kubernetes mail long and unreadable. With "both" the notebook is made first
 * and linked at the top; otherwise the footer says where the queries are.
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
  for (const { entry, report, data } of reports) {
    parts.push("---");
    parts.push(report ? report : "## " + entry.title[language] + "\\n\\n" + text.missing);
    parts.push(data);
  }
  parts.push("---");
  parts.push("_" + (notebookUrl ? text.mailFooterLinked : text.mailFooter) + "_");
  // The tenant leads the subject so an inbox fed by several tenants sorts and filters by it; the
  // notebook keeps the plain title - it lives in its tenant already.
  return { subject: (tenant ? "[" + tenant + "] " : "") + title, body: parts.join("\\n\\n"), notebookUrl };
}
`;

/**
 * The key-action candidates for the AI (RANK_TASK): the same query results and the same ranking the
 * notebook falls back to, as numbered lines in the run's language.
 */
const rankScript = () => `// ${MARKER}
import { executionsClient } from "@dynatrace-sdk/client-automation";

${collectReports()}
export default async function ({ execution_id }) {
  const { language, scope, byName } = await gather(execution_id);
  const candidates = rankActions(byName, language, scope);
  return { count: candidates.length, candidates: candidates.map((line, index) => String(index + 1) + ". " + line).join(NL) };
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
    // Right of the queries: two tasks on one spot make the workflow invalid to save.
    position: { x: 6, y: 1 },
    predecessors: [],
    conditions: { states: {} },
  },
  // The queries, side by side.
  k8s_cluster_cpu: query("k8s_cluster_cpu", "kubernetes", { x: -4, y: 1 }),
  k8s_cluster_memory: query("k8s_cluster_memory", "kubernetes", { x: -3, y: 1 }),
  k8s_workload_cpu: query("k8s_workload_cpu", "kubernetes", { x: -2, y: 1 }),
  k8s_workload_memory: query("k8s_workload_memory", "kubernetes", { x: -1, y: 1 }),
  k8s_rightsizing: query("k8s_rightsizing", "kubernetes", { x: 0, y: 1 }),
  host_utilization: query("host_utilization", "host", { x: 1, y: 1 }),
  disk_overutilized: query("disk_overutilized", "disk", { x: 2, y: 1 }),
  disk_underutilized: query("disk_underutilized", "disk", { x: 3, y: 1 }),
  network_updown_interfaces: query("network_updown_interfaces", "network", { x: 4, y: 1 }),
  network_saturated_interfaces: query("network_saturated_interfaces", "network", { x: 5, y: 1 }),
  // The key-action candidates from whatever queries came back (ANY - a failed one is left out).
  [RANK_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Ranks the key-action candidates across the domains from the query results",
    input: { script: rankScript() },
    position: { x: 0, y: 2 },
    predecessors: INFRA_DOMAINS.flatMap((domain) => DOMAINS[domain].queries),
    conditions: { states: Object.fromEntries(INFRA_DOMAINS.flatMap((domain) => DOMAINS[domain].queries).map((name) => [name, "ANY"])), custom: `{{ ${ANY_SCOPE} }}`, else: "SKIP" },
  },
  // The AI picks the key actions from them; no candidates, no call.
  [SUMMARY_TASK]: {
    action: "dynatrace.davis.workflow.actions:prompt-generative-ai",
    description: "Picks and words the key actions from the ranked candidates with Dynatrace generative AI",
    input: promptInput(SUMMARY_PROMPT, withLanguage(SUMMARY_INSTRUCTION), SUMMARY_DATA),
    position: { x: 0, y: 3 },
    predecessors: [RANK_TASK],
    conditions: { states: { [RANK_TASK]: "OK" }, custom: `{{ result("${RANK_TASK}")["count"] > 0 }}`, else: "SKIP" },
    retry: PROMPT_RETRY,
  },
  // Delivery: one notebook and/or one email with every report (ANY - the reports that did come out go
  // out when a later step failed). The notebook comes first so the email can link to it.
  [NOTEBOOK_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Saves every report of the run, with its queries, as one notebook (delivery: notebook or both)",
    input: { script: notebookScript() },
    position: { x: 0, y: 4 },
    predecessors: [SUMMARY_TASK],
    conditions: { states: { [SUMMARY_TASK]: "ANY" }, custom: `{{ ${BY_NOTEBOOK} }}`, else: "SKIP" },
  },
  [COMPOSE_EMAIL_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Puts every report of the run into one email body, linking the notebook when there is one (delivery: email or both)",
    input: { script: composeEmailScript() },
    position: { x: 0, y: 5 },
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
    position: { x: 0, y: 6 },
    predecessors: [COMPOSE_EMAIL_TASK],
    conditions: { states: { [COMPOSE_EMAIL_TASK]: "OK" }, custom: `{{ ${BY_EMAIL} }}`, else: "SKIP" },
  },
});

/**
 * The tasks, each carrying its own key as `name`: the Workflows app's create-workflow intent opens an
 * empty editor without it (see analyzeWorkflow.ts).
 */
export const infraOptimizationTasks = () => {
  const definitions = taskDefinitions();
  // The Workflows app refuses to save a workflow with two tasks on one position ("invalid
  // configuration in task ...") - v15 put k8s_rightsizing on cleanup_old_versions' spot.
  const taken = new Map<string, string>();
  for (const [name, task] of Object.entries(definitions)) {
    const spot = `${task.position.x},${task.position.y}`;
    const other = taken.get(spot);
    if (other) throw new Error(`Tasks ${other} and ${name} share position ${spot}`);
    taken.set(spot, name);
  }
  return Object.fromEntries(Object.entries(definitions).map(([name, task]) => [name, { name, ...task }]));
};

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
