import type { InfraQueryName } from "./infraOptimizationQueries";

/**
 * The Infrastructure Optimization report's text, written from the query results by the notebook and
 * email scripts (v20). Until v19 an AI wrote each domain's report around the data tables, and each run
 * brought a new kind of mistake: throttling blamed on the requests, a finding the data lacked ("0개"),
 * a workload placed in the wrong cluster, a value copied from the row below (frontend 1,862 for 1,680).
 * Each finding's meaning and change are fixed here, checked once against Kubernetes' rules, and the
 * sentences take their numbers from the records; the AI only picks the key actions out of a ranked
 * list (rankActions) that carries the numbers already.
 */

type Text = { Korean: string; English: string };
const text = (korean: string, english: string): Text => ({ Korean: korean, English: english });

/**
 * What each finding means and what to change, keyed "<kind> <finding>" - shown under the finding's
 * table. The Kubernetes ones follow the scheduler and kubelet: throttling comes only from a CPU limit,
 * CPU never causes eviction, a CPU limit reserves nothing, memory above the requests is not reserved
 * (high limits overcommit the node), and requests equal to limits are Guaranteed QoS.
 */
export const MEANINGS: Record<string, Text> = {
  "cpu INCREASE_LIMITS": text(
    "CPU 사용량이 제한의 90%를 넘고 스로틀링이 발생합니다. 스로틀링은 CPU 제한 때문에 생기므로 제한을 권장값으로 올리세요.",
    "CPU use is over 90% of the limit and the workload is throttled. Throttling comes from the CPU limit, so raise the limit to the recommended value.",
  ),
  "cpu NO_REQUESTS_SET": text(
    "CPU 요청이 없습니다. 노드가 바쁠 때 필요한 CPU를 보장받지 못해 느려질 수 있으니 권장 요청을 설정하세요. CPU 때문에 축출되지는 않습니다.",
    "No CPU requests are set. On a busy node the workload is not guaranteed the CPU it needs and can slow down, so set the recommended requests. CPU never causes eviction.",
  ),
  "cpu INCREASE_REQUESTS": text(
    "CPU 요청이 사용량보다 적습니다. 노드가 바쁠 때 필요한 CPU를 보장받지 못해 느려질 수 있으니 요청을 권장값으로 올리세요. CPU 때문에 축출되지는 않습니다.",
    "The CPU requests are below use. On a busy node the workload is not guaranteed the CPU it needs and can slow down, so raise the requests to the recommended value. CPU never causes eviction.",
  ),
  "cpu REDUCE_REQUESTS": text(
    "예약한 CPU의 대부분을 쓰지 않습니다. 예약은 다른 Pod가 쓸 수 없으니 요청을 권장값으로 줄이세요.",
    "Most of the reserved CPU goes unused, and no other pod can have it, so lower the requests to the recommended value.",
  ),
  "cpu REDUCE_LIMITS": text(
    "CPU 제한이 사용량보다 훨씬 높습니다. CPU 제한은 아무것도 예약하지 않으므로 높은 제한은 남는 CPU를 더 쓰게 할 뿐입니다. 줄이는 것은 선택 사항이며, 줄이면 성능이 더 예측 가능해집니다.",
    "The CPU limit is far above use. A CPU limit reserves nothing, so a high one only lets the workload use idle CPU. Lowering it is optional and makes performance more predictable.",
  ),
  "cpu NOMINAL": text("요청과 제한이 사용량에 맞습니다.", "Requests and limits fit the use."),
  "memory OOM_KILLS": text(
    "컨테이너가 메모리 제한에 도달해 종료(OOMKill)되었습니다. 제한을 권장값으로 올리세요.",
    "The container reached its memory limit and was killed (OOM). Raise the limit to the recommended value.",
  ),
  "memory INCREASE_LIMITS": text(
    "작업 세트가 제한의 90%를 넘어 OOMKill에 가깝습니다. 제한을 권장값으로 올리세요. 작업 세트가 제한과 거의 같다면 페이지 캐시가 제한까지 찬 것일 수 있으니 실제 필요량을 먼저 확인하세요.",
    "The working set is over 90% of the limit, close to an OOM kill. Raise the limit to the recommended value. A working set almost equal to the limit can be page cache filling up to it, so check the actual need first.",
  ),
  "memory NO_LIMIT_SET": text(
    "메모리 제한이 없어 컨테이너가 노드 메모리를 제한 없이 쓸 수 있습니다. 권장 제한을 설정하세요.",
    "No memory limit is set, so the container can take node memory without bound. Set the recommended limit.",
  ),
  "memory NO_REQUESTS_SET": text(
    "메모리 요청이 없어 노드 메모리가 부족할 때 가장 먼저 축출됩니다. 권장 요청을 설정하세요.",
    "No memory requests are set, so the workload is the first evicted under memory pressure. Set the recommended requests.",
  ),
  "memory INCREASE_REQUESTS": text(
    "메모리 요청이 작업 세트보다 적어 노드 메모리가 부족할 때 먼저 축출될 수 있습니다. 요청을 권장값으로 올리세요.",
    "The memory requests are below the working set, so the workload is among the first evicted under memory pressure. Raise the requests to the recommended value.",
  ),
  "memory REDUCE_REQUESTS": text(
    "예약한 메모리의 대부분을 쓰지 않습니다. 예약은 다른 Pod가 쓸 수 없으니 요청을 권장값으로 줄이세요.",
    "Most of the reserved memory goes unused, and no other pod can have it, so lower the requests to the recommended value.",
  ),
  "memory REDUCE_LIMITS": text(
    "메모리 제한이 작업 세트보다 훨씬 높습니다. 요청을 넘는 메모리는 예약되지 않으므로 높은 제한은 노드 메모리의 오버커밋을 허용하고, 메모리가 부족해지면 노드가 Pod를 축출합니다. 제한을 권장값으로 줄이세요.",
    "The memory limit is far above the working set. Memory above the requests is not reserved, so high limits let the node's memory be overcommitted, and under memory pressure the node evicts pods. Lower the limit to the recommended value.",
  ),
  "memory NOMINAL": text("요청과 제한이 작업 세트에 맞습니다.", "Requests and limits fit the working set."),
  "workload EXCLUDED_NO_CONTROLLER": text(
    "컨트롤러가 없는 Pod입니다. 다른 방식으로 크기를 정하므로 권고하지 않습니다.",
    "Pods without a controller: they are sized elsewhere, so they get no advice.",
  ),
  "workload EXCLUDED_STATIC_POD": text(
    "정적 Pod(컨트롤 플레인, kube-proxy 등)입니다. 노드에서 직접 관리되므로 권고하지 않습니다.",
    "Static pods (the control plane, kube-proxy): the node manages them, so they get no advice.",
  ),
  "cluster SCALE_DOWN": text(
    "요청을 담는 데 필요한 노드보다 노드가 많습니다. 줄일 수 있는 노드만큼 축소할 수 있습니다.",
    "There are more nodes than the requests need; the removable nodes can go.",
  ),
  "cluster SCALE_UP": text("요청을 담기에 노드가 부족합니다. 노드를 추가하세요.", "The nodes cannot hold the requests; add nodes."),
  "cluster NOMINAL": text("노드 수가 요청에 맞습니다.", "The node count fits the requests."),
  "host UNUSED": text("CPU와 메모리를 거의 쓰지 않습니다. 종료 후보입니다.", "Hardly any CPU or memory is used: candidates to shut down."),
  "host OVERPROVISIONED": text("자원이 남습니다. 더 작은 인스턴스로 옮기세요 (종료 대상은 아닙니다).", "Resources are left over: move to smaller instances (not to shut down)."),
  "host UNDERPROVISIONED": text("CPU가 부족합니다. 더 큰 인스턴스로 옮기세요.", "CPU runs short: move to larger instances."),
  "host NOMINAL": text("현재 크기를 유지합니다.", "Keep the current size."),
  "host KUBERNETES_NODE": text(
    "Kubernetes 노드는 클러스터 단위로 크기를 정하므로 Kubernetes 리포트의 클러스터 항목을 참고하세요. 호스트 CPU는 호스트의 모든 프로세스를 30일 동안 본 값입니다.",
    "Kubernetes nodes are sized with their cluster: see the cluster section of the Kubernetes report. Host CPU covers everything on the host over 30 days.",
  ),
  "host NOT_REPORTING": text(
    "최근 24시간 동안 데이터가 없습니다. 교체되었거나 종료된 것으로 보여 권고하지 않습니다.",
    "No data in the last 24 hours: replaced or stopped, so they get no advice.",
  ),
};

/** Which kind of meaning each finding table takes (see MEANINGS). */
export const MEANING_KINDS: Partial<Record<InfraQueryName, string>> = {
  k8s_cluster_cpu: "cluster",
  k8s_workload_cpu: "cpu",
  k8s_workload_memory: "memory",
  host_utilization: "host",
};

/** How to read each table, shown above it. */
export const TABLE_NOTES: Record<InfraQueryName, Text> = {
  k8s_cluster_cpu: text(
    "필요 노드 수는 요청 합계를 노드당 할당 가능량의 85%로 나눠 올림한 값이며, 사용량으로 정하지 않습니다. 최소 노드 수는 CPU와 메모리 중 더 많은 쪽입니다.",
    "Nodes needed are the requests divided by 85% of the allocatable per node, rounded up - usage does not set them. The minimum is the larger of the CPU and memory counts.",
  ),
  k8s_cluster_memory: text("메모리 기준 필요 노드 수는 클러스터 CPU 표의 값과 같은 방식으로 계산합니다.", "Nodes needed for memory are computed the same way as in the cluster CPU table."),
  k8s_workload_cpu: text(
    "값은 Pod 하나(레플리카 하나, 컨테이너 합계) 기준이며 권장값도 Pod당 값입니다. '유지'는 현재 설정을 유지한다는 뜻입니다. '제한 일부 미설정'이 '예'이면 일부 컨테이너에만 제한이 있어 제한은 판단하지 않습니다. 스로틀링 지표는 상대값이며 단위가 없습니다.",
    "Values are per pod (one replica, its containers summed), and so are the recommendations. 'keep' keeps the current setting. Where limits are partly unset, only some containers have a limit, so the limit is not judged. The throttling indicator is relative and has no unit.",
  ),
  k8s_workload_memory: text(
    "값은 Pod 하나(레플리카 하나, 컨테이너 합계) 기준이며 권장값도 Pod당 값입니다. '유지'는 현재 설정을 유지한다는 뜻입니다. '제한 일부 미설정'이 '예'이면 일부 컨테이너에만 제한이 있어 제한은 판단하지 않습니다. 요청과 제한이 같은 설정(Guaranteed QoS)은 문제가 아닙니다.",
    "Values are per pod (one replica, its containers summed), and so are the recommendations. 'keep' keeps the current setting. Where limits are partly unset, only some containers have a limit, so the limit is not judged. Requests equal to limits (Guaranteed QoS) are sound.",
  ),
  k8s_rightsizing: text(
    "분석한 워크로드의 요청을 모두 권장값으로 바꿨을 때의 요청 합계와 노드 수입니다 (레플리카 수 반영). 제외한 Pod의 요청은 그대로 둡니다.",
    "The requests and node counts once every analyzed workload takes its recommended requests (every replica counted). The pods left out keep theirs.",
  ),
  host_utilization: text("30일 p90 사용률로 호스트를 나눴습니다. 각 그룹은 그룹 전체의 범위와 일부 예시를 보여 줍니다.", "Hosts grouped by their 30-day p90 use; each group shows its whole range and some examples."),
  disk_overutilized: text(
    "30일 동안 사용률이 95%를 넘은 디스크입니다. 가득 차면 장애로 이어질 수 있으니 확장하거나 정리하세요.",
    "Disks above 95% use in the last 30 days. A full disk can cause an outage, so grow or clean them up.",
  ),
  disk_underutilized: text(
    "30일 동안 사용률이 50%를 넘지 않은 50 GiB 이상 디스크를 마운트와 크기별로 묶었습니다. 권장 크기는 30일 최대 사용량에 30%를 더한 값이며, 회수 가능 용량은 그룹의 디스크를 모두 권장 크기로 줄였을 때의 값입니다. 데이터베이스 볼륨은 줄이기 전에 데이터 증가 예상을 확인하세요.",
    "Disks of 50 GiB or more that stayed under 50% use in 30 days, grouped by mount and size. The recommended size is the 30-day peak plus 30%; the reclaimable space is what the group frees with every disk at that size. Check the expected data growth of database volumes before shrinking them.",
  ),
  network_saturated_interfaces: text(
    "7일 p95 트래픽이 인터페이스 속도의 85% 이상입니다. 회선 증설이나 트래픽 분산을 검토하세요.",
    "Interfaces whose 7-day p95 traffic is at or above 85% of their speed: consider an upgrade or rerouting traffic.",
  ),
  network_updown_interfaces: text(
    "관리 상태는 up인데 동작 상태가 down인 인터페이스입니다. 쓰지 않는 포트일 수도 있지만 케이블이나 NIC 문제일 수 있으니 확인하세요.",
    "Interfaces administratively up but operationally down. It can be an unused port, but also a cable or NIC problem - check them.",
  ),
};

/**
 * The script part that writes each domain's report and ranks the key actions, inside collectReports()
 * (it uses NL, num, cell, firstNested, examplesOf, findingLabel and findingRank from there). No
 * backticks or template placeholders: it is itself inside a template literal.
 */
export const REPORT_WRITER = `
// ---- The report text: fixed sentences, numbers from the records (v20) --------------------------
const MEANINGS = ${JSON.stringify(MEANINGS)};
const fmt = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "-" : groupDigits(Number(value)));
const workloadName = (row) => String(row["k8s.workload.name"]) + " (" + String(row["k8s.cluster.name"]) + ")";
const findingsOf = (records) => firstNested(records, "findings");
const findingOf = (records, finding) => findingsOf(records).find((group) => group.finding === finding);
const countOf = (records, finding) => num(findingOf(records, finding)?.count_workloads_with_finding) ?? 0;
const meaningOf = (kind, finding, language) => MEANINGS[kind + " " + finding][language];
const examplesFor = (group) => (group && Array.isArray(group.examples) ? group.examples : []);
const isKorean = (language) => language !== "English";
const unitWord = (language, kind) => (isKorean(language) ? (kind === "machine" ? "대" : "개") : "");
const counted = (value, language, kind) => fmt(value) + unitWord(language, kind);
// A few names and "등"/"and more" when the count is larger.
const someNames = (names, total, language) => {
  const shown = names.slice(0, 3);
  if (shown.length === 0) return "";
  const more = num(total) !== null && num(total) > shown.length;
  return shown.join(", ") + (more ? (isKorean(language) ? " 등" : " and more") : "");
};
const failedLine = (title, language) => "- " + title + ": " + (isKorean(language) ? "데이터를 가져오지 못했습니다. 이 환경에서 수집하지 않는 데이터일 수 있습니다." : "no data - the query failed, typically because this environment does not collect that data.");

// Workload findings in priority order: risks (OOM, limits), then missing settings, then increases,
// then reductions.
const K8S_ORDER = [
  ["memory", "OOM_KILLS"], ["memory", "INCREASE_LIMITS"], ["cpu", "INCREASE_LIMITS"],
  ["memory", "NO_LIMIT_SET"], ["memory", "NO_REQUESTS_SET"], ["cpu", "NO_REQUESTS_SET"],
  ["memory", "INCREASE_REQUESTS"], ["cpu", "INCREASE_REQUESTS"],
  ["memory", "REDUCE_REQUESTS"], ["cpu", "REDUCE_REQUESTS"], ["memory", "REDUCE_LIMITS"], ["cpu", "REDUCE_LIMITS"],
];
const resourceWord = (kind, language) => (kind === "memory" ? (isKorean(language) ? "메모리" : "Memory") : "CPU");
const queryOfKind = (kind) => (kind === "memory" ? "k8s_workload_memory" : "k8s_workload_cpu");
const DATABASE_MARKS = ["mongo", "mysql", "maria", "postgres", "pgdata", "oracle", "elastic", "opensearch", "kafka", "cassandra", "redis", "valkey", "clickhouse", "db"];

const writeKubernetes = (byName, language, titles) => {
  const ko = isKorean(language);
  const overview = [];
  const notes = [];
  const clusterCpu = byName.k8s_cluster_cpu;
  const after = Array.isArray(byName.k8s_rightsizing) ? byName.k8s_rightsizing : [];
  if (!Array.isArray(clusterCpu)) overview.push(failedLine(titles.k8s_cluster_cpu, language));
  else {
    const groups = clusterCpu.slice().sort((a, b) => findingRank(a.finding) - findingRank(b.finding));
    const total = groups.reduce((sum, group) => sum + (num(group.count_clusters_with_finding) ?? 0), 0);
    const parts = groups.map((group) => findingLabel(group.finding, language) + " " + counted(group.count_clusters_with_finding, language));
    overview.push("- " + (ko ? "클러스터 " + counted(total, language) + ": " : total + (total === 1 ? " cluster: " : " clusters: ")) + parts.join(", ") + ".");
    for (const cluster of examplesOf(clusterCpu)) {
      const name = String(cluster["k8s.cluster.name"]);
      let line = "**" + name + "**: " + (ko
        ? "현재 노드 " + counted(cluster.avg_node_count, language, "machine") + ". CPU 기준 " + counted(cluster.nodes_needed_for_cpu, language, "machine") + ", 메모리 기준 " + counted(cluster.nodes_needed_for_memory, language, "machine") + "가 필요해 최소 " + counted(cluster.minimum_nodes, language, "machine") + "입니다."
        : fmt(cluster.avg_node_count) + " nodes now. CPU needs " + fmt(cluster.nodes_needed_for_cpu) + " nodes and memory " + fmt(cluster.nodes_needed_for_memory) + ", so at least " + fmt(cluster.minimum_nodes) + " are needed.");
      if (cluster.finding === "SCALE_DOWN") line += ko ? " " + counted(cluster.removable_nodes, language, "machine") + "를 줄일 수 있습니다." : " " + fmt(cluster.removable_nodes) + " can go.";
      if (cluster.finding === "SCALE_UP") line += ko ? " 노드를 추가해야 합니다." : " More nodes are needed.";
      const resized = after.find((row) => row["k8s.cluster.name"] === name);
      if (resized) {
        const removable = num(resized.removable_nodes_after) ?? 0;
        const short = num(resized.minimum_nodes_after) !== null && num(resized.avg_node_count) !== null && num(resized.minimum_nodes_after) > num(resized.avg_node_count);
        line += ko
          ? " Pod 요청을 권장값으로 바꾸면 CPU 기준 " + counted(resized.nodes_needed_after_for_cpu, language, "machine") + ", 메모리 기준 " + counted(resized.nodes_needed_after_for_memory, language, "machine") + "로 최소 " + counted(resized.minimum_nodes_after, language, "machine") + "가 되어 " + (removable > 0 ? counted(removable, language, "machine") + "를 줄일 수 있습니다." : short ? "여전히 노드를 추가해야 합니다." : "줄일 수 있는 노드는 없습니다.")
          : " With the recommended pod requests, CPU needs " + fmt(resized.nodes_needed_after_for_cpu) + " nodes and memory " + fmt(resized.nodes_needed_after_for_memory) + ", so at least " + fmt(resized.minimum_nodes_after) + (removable > 0 ? ", and " + fmt(removable) + " can go." : short ? ", still more than there are." : ", and no node can go.");
        const cpuShare = num(resized.analyzed_cpu_requests_percent);
        const memShare = num(resized.analyzed_mem_requests_percent);
        if ((cpuShare !== null && cpuShare < 50) || (memShare !== null && memShare < 50)) {
          const names = Array.isArray(resized.excluded_names) ? resized.excluded_names.map(String) : [];
          line += ko
            ? " 다만 분석한 워크로드는 이 클러스터 CPU 요청의 " + fmt(cpuShare) + "%, 메모리 요청의 " + fmt(memShare) + "%만 차지합니다. 나머지는 제외한 Pod" + (names.length > 0 ? "(예: " + someNames(names, names.length + 1, language) + ")" : "") + "의 몫이므로, 그 Pod의 크기를 정하는 쪽이 효과가 더 큽니다."
            : " The analyzed workloads hold only " + fmt(cpuShare) + "% of this cluster's CPU requests and " + fmt(memShare) + "% of its memory requests; the rest belongs to the pods left out" + (names.length > 0 ? " (such as " + someNames(names, names.length + 1, language) + ")" : "") + ", so sizing those is the larger lever.";
        }
      }
      overview.push("- " + line);
    }
  }

  // Workload counts, CPU first; memory only when its counts differ.
  for (const kind of ["cpu", "memory"]) {
    const records = byName[queryOfKind(kind)];
    if (!Array.isArray(records)) {
      overview.push(failedLine(titles[queryOfKind(kind)], language));
      continue;
    }
    const first = records[0] ?? {};
    const cpuFirst = Array.isArray(byName.k8s_workload_cpu) ? byName.k8s_workload_cpu[0] ?? {} : null;
    if (kind === "memory" && cpuFirst && ["total_workloads", "analyzed_workloads", "excluded_workloads"].every((field) => num(cpuFirst[field]) === num(first[field]))) continue;
    const noController = countOf(records, "EXCLUDED_NO_CONTROLLER");
    const staticPods = countOf(records, "EXCLUDED_STATIC_POD");
    overview.push("- " + (ko
      ? "워크로드(" + resourceWord(kind, language) + " 기준): 전체 " + counted(first.total_workloads, language) + " 중 " + counted(first.analyzed_workloads, language) + "를 분석하고 " + counted(first.excluded_workloads, language) + "를 제외했습니다 (컨트롤러 없는 Pod " + counted(noController, language) + ", 정적 Pod " + counted(staticPods, language) + ")."
      : "Workloads (" + resourceWord(kind, language) + "): of " + fmt(first.total_workloads) + ", " + fmt(first.analyzed_workloads) + " were analyzed and " + fmt(first.excluded_workloads) + " left out (" + fmt(noController) + " without a controller, " + fmt(staticPods) + " static pods)."));
  }

  // Priorities: every finding the data has, in K8S_ORDER, with a few names.
  const priorities = [];
  for (const [kind, finding] of K8S_ORDER) {
    const group = findingOf(byName[queryOfKind(kind)], finding);
    if (!group || !(num(group.count_workloads_with_finding) > 0)) continue;
    const names = examplesFor(group).map(workloadName);
    priorities.push(resourceWord(kind, language) + " · " + findingLabel(finding, language) + " " + counted(group.count_workloads_with_finding, language) + (names.length > 0 ? ": " + someNames(names, group.count_workloads_with_finding, language) : ""));
  }
  const nodeChange = after.some((row) => (num(row.removable_nodes_after) ?? 0) > 0) || examplesOf(clusterCpu).some((cluster) => cluster.finding === "SCALE_UP");
  if (nodeChange) priorities.push(ko ? "노드 수: Pod 크기를 조정한 뒤 위 클러스터별 최소 노드 수에 맞춰 조정하세요." : "Nodes: once the pods are resized, adjust each cluster to its minimum above.");

  // Notes that apply to items in the data: partly unset limits, and working sets at the limit.
  // Per resource: one list for both read as a contradiction - mongodb's CPU limit was partial while
  // its memory limit got advice (diw85600).
  const partial = { cpu: [], memory: [] };
  const atLimit = [];
  for (const kind of ["cpu", "memory"]) {
    for (const group of findingsOf(byName[queryOfKind(kind)])) {
      for (const row of examplesFor(group)) {
        if (row.limits_partial === true && !partial[kind].includes(workloadName(row))) partial[kind].push(workloadName(row));
        const used = num(row.p95_working_set_mib);
        const limit = num(row.p95_limits_mib);
        if (kind === "memory" && row.limits_partial !== true && used !== null && limit !== null && limit > 0 && used >= limit * 0.99 && !atLimit.includes(workloadName(row))) atLimit.push(workloadName(row));
      }
    }
  }
  for (const kind of ["cpu", "memory"]) {
    const names = partial[kind];
    if (names.length > 0) notes.push(ko ? "- 일부 컨테이너에만 " + resourceWord(kind, language) + " 제한이 있어 " + resourceWord(kind, language) + " 제한은 판단하지 않은 워크로드: " + someNames(names, names.length, language) : "- " + someNames(names, names.length, language) + ": only some containers set a " + resourceWord(kind, language) + " limit, so that limit is not judged.");
  }
  if (atLimit.length > 0) notes.push(ko ? "- 작업 세트가 메모리 제한과 거의 같은 워크로드: " + someNames(atLimit, atLimit.length, language) + ". 페이지 캐시가 제한까지 찬 것일 수 있으니, 제한을 올리기 전에 실제 필요량을 확인하세요." : "- " + someNames(atLimit, atLimit.length, language) + ": the working set is almost at the memory limit. That can be page cache filling up to it, so check the actual need before raising the limit.");
  return { overview, priorities, notes };
};

const HOST_ACTIONS = { UNDERPROVISIONED: 1, UNUSED: 2, OVERPROVISIONED: 3 };
// Short names in the text; the tables keep the long ones with their pointers.
const HOST_SHORT = { KUBERNETES_NODE: ["Kubernetes 노드", "Kubernetes nodes"], NOT_REPORTING: ["24시간 데이터 없음", "no data for 24 h"] };
const hostGroupLabel = (group, language) => (HOST_SHORT[group.utilization] ? HOST_SHORT[group.utilization][isKorean(language) ? 0 : 1] : findingLabel(group.utilization, language)) + (group.k8s_cluster ? " (" + String(group.k8s_cluster) + ")" : "");
// "82%" rather than "82~82%" for a group whose hosts all sit at one value.
const span = (min, max) => (fmt(min) === fmt(max) ? fmt(min) : fmt(min) + "~" + fmt(max));
const hostRange = (group, language) => "CPU p90 " + span(group.cpu_p90_min_percent, group.cpu_p90_max_percent) + "%, " + (isKorean(language) ? "메모리" : "memory") + " p90 " + span(group.mem_p90_min_percent, group.mem_p90_max_percent) + "%";
const hostNames = (group) => examplesFor(group).map((row) => String(row["dt.entity.host.name"]));

const writeHost = (byName, language, titles) => {
  const ko = isKorean(language);
  const records = byName.host_utilization;
  if (!Array.isArray(records)) return { overview: [failedLine(titles.host_utilization, language)], priorities: [], notes: [] };
  const first = records[0] ?? {};
  const groups = firstNested(records, "utilization_groups").slice().sort((a, b) => findingRank(a.utilization) - findingRank(b.utilization));
  const overview = ["- " + (ko ? "전체 호스트 " + counted(first.total_hosts, language, "machine") + ": " : fmt(first.total_hosts) + " hosts: ") + groups.map((group) => hostGroupLabel(group, language) + " " + counted(group.count, language, "machine")).join(", ") + "."];
  const priorities = groups
    .filter((group) => group.utilization in HOST_ACTIONS)
    .sort((a, b) => HOST_ACTIONS[a.utilization] - HOST_ACTIONS[b.utilization])
    .map((group) => hostGroupLabel(group, language) + " " + counted(group.count, language, "machine") + " (" + hostRange(group, language) + "): " + meaningOf("host", group.utilization, language) + " " + (ko ? "예: " : "For example ") + someNames(hostNames(group), group.count, language));
  const notes = [];
  if (groups.some((group) => group.utilization === "KUBERNETES_NODE")) notes.push("- " + meaningOf("host", "KUBERNETES_NODE", language));
  const gone = groups.find((group) => group.utilization === "NOT_REPORTING");
  if (gone) notes.push("- " + (ko ? "최근 24시간 데이터가 없는 호스트 " + counted(gone.count, language, "machine") + "는 교체되었거나 종료된 것으로 보여 권고하지 않습니다." : fmt(gone.count) + " hosts sent no data in the last 24 hours - replaced or stopped - and get no advice."));
  return { overview, priorities, notes };
};

const writeDisk = (byName, language, titles) => {
  const ko = isKorean(language);
  const overview = [];
  const priorities = [];
  const notes = [];
  const over = byName.disk_overutilized;
  if (!Array.isArray(over)) overview.push(failedLine(titles.disk_overutilized, language));
  else {
    const count = num(over[0]?.count) ?? 0;
    const rows = firstNested(over, "examples");
    if (count === 0) overview.push("- " + (ko ? "30일 동안 사용률이 95%를 넘은 디스크는 없습니다." : "No disk went above 95% use in 30 days."));
    else {
      overview.push("- " + (ko ? "30일 동안 사용률이 95%를 넘은 디스크 " + counted(count, language) + "가 있습니다." : fmt(count) + " disks went above 95% use in 30 days."));
      for (const row of rows.slice(0, 3)) priorities.push(String(row["dt.entity.host.name"]) + " " + String(row["dt.entity.disk.name"]) + (ko ? ": 최대 사용률 " + fmt(row.max_disk_percent) + "%, 크기 " + fmt(row.disk_size_gib) + " GiB, 최소 여유 " + fmt(row.never_used_gib) + " GiB - 확장하거나 정리하세요." : ": peak " + fmt(row.max_disk_percent) + "%, size " + fmt(row.disk_size_gib) + " GiB, least free " + fmt(row.never_used_gib) + " GiB - grow or clean up."));
    }
  }
  const under = byName.disk_underutilized;
  if (!Array.isArray(under)) overview.push(failedLine(titles.disk_underutilized, language));
  else {
    const first = under[0] ?? {};
    const groups = firstNested(under, "groups");
    if (groups.length === 0) overview.push("- " + (ko ? "줄일 만한 디스크(50 GiB 이상, 사용률 50% 미만)는 없습니다." : "No disk to shrink (50 GiB or more, under 50% use)."));
    else {
      overview.push("- " + (ko ? "사용률 50% 미만 디스크 " + counted(first.disk_count, language) + "(" + counted(first.group_count, language) + " 그룹)를 권장 크기로 줄이면 합계 " + fmt(first.total_reclaimable_gib) + " GiB를 회수할 수 있습니다." : fmt(first.disk_count) + " disks under 50% use (" + fmt(first.group_count) + " groups) free " + fmt(first.total_reclaimable_gib) + " GiB in total at their recommended sizes."));
      for (const group of groups.slice(0, 3)) priorities.push(ko ? String(group.mount) + " " + fmt(group.disk_size_gib) + " GiB 디스크 " + counted(group.disks, language) + ": 30일 최대 사용량 " + fmt(group.max_used_gib) + " GiB - " + fmt(group.recommended_size_gib) + " GiB로 줄이면 " + fmt(group.reclaimable_gib) + " GiB 회수" : String(group.mount) + ", " + fmt(group.disks) + " disks of " + fmt(group.disk_size_gib) + " GiB: 30-day peak " + fmt(group.max_used_gib) + " GiB - shrunk to " + fmt(group.recommended_size_gib) + " GiB, " + fmt(group.reclaimable_gib) + " GiB freed");
      const databases = groups.map((group) => String(group.mount)).filter((mount, index, all) => all.indexOf(mount) === index && DATABASE_MARKS.some((mark) => mount.toLowerCase().includes(mark)));
      if (databases.length > 0) notes.push("- " + (ko ? "데이터베이스 볼륨으로 보이는 마운트: " + someNames(databases, databases.length, language) + ". 줄이기 전에 데이터 증가 예상을 확인하세요." : someNames(databases, databases.length, language) + " look like database volumes: check the expected data growth before shrinking them."));
    }
  }
  return { overview, priorities, notes };
};

const UPDOWN = "network_updown_interfaces";
const writeNetwork = (byName, language, titles) => {
  const ko = isKorean(language);
  const overview = [];
  const saturated = byName.network_saturated_interfaces;
  if (!Array.isArray(saturated)) overview.push(failedLine(titles.network_saturated_interfaces, language));
  else overview.push("- " + (ko ? "포화 인터페이스(7일 p95 85% 이상): " + counted(saturated.length, language) : "Saturated interfaces (7-day p95 at or above 85%): " + saturated.length) + (saturated.length > 0 ? " - " + someNames(saturated.map((row) => String(row.device) + " " + String(row.interface)), saturated.length, language) : ""));
  const updown = byName[UPDOWN];
  if (!Array.isArray(updown)) overview.push(failedLine(titles.network_updown_interfaces, language));
  else overview.push("- " + (ko ? "Up/Down 인터페이스: " + counted(updown.length, language) : "Up/down interfaces: " + updown.length) + (updown.length > 0 ? " - " + someNames(updown.map((row) => String(row.parentDeviceName)), updown.length, language) : ""));
  return { overview, priorities: [], notes: [] };
};

const WRITERS = { kubernetes: writeKubernetes, host: writeHost, disk: writeDisk, network: writeNetwork };

/** One domain's report: its title, an overview, the priorities and notes - all from the records. */
const writeReport = (entry, byName, language) => {
  const ko = isKorean(language);
  const titles = Object.fromEntries(entry.queries.map((item) => [item.name, item.title[language]]));
  const { overview, priorities, notes } = WRITERS[entry.domain](byName, language, titles);
  const parts = ["## " + entry.title[language], "**" + (ko ? "개요" : "Overview") + "**" + NL + NL + overview.join(NL)];
  if (priorities.length > 0) parts.push("**" + (ko ? "우선순위" : "Priorities") + "**" + NL + NL + priorities.map((line, index) => String(index + 1) + ". " + line).join(NL));
  if (notes.length > 0) parts.push("**" + (ko ? "참고" : "Notes") + "**" + NL + NL + notes.join(NL));
  return parts.join(NL + NL);
};

// ---- Key-action candidates: ranked here, the AI only picks and words them -----------------------
const change = (label, from, to, unit, language) => (to === null || to === undefined ? "" : label + " " + (from === null || from === undefined ? (isKorean(language) ? "미설정" : "unset") : fmt(from)) + " → " + fmt(to) + " " + unit);
const joined = (parts) => parts.filter((part) => part).join(", ");
const perPod = (row, language) => (isKorean(language) ? " (Pod당, Pod " + counted(row.pods, language) + ")" : " (per pod, " + fmt(row.pods) + " pods)");
const memoryChange = (row, language) => joined([change(isKorean(language) ? "제한" : "limit", row.p95_limits_mib, row.recommended_limit_mib, "MiB", language), change(isKorean(language) ? "요청" : "requests", row.p95_requests_mib, row.recommended_request_mib, "MiB", language)]);
const cpuChange = (row, language) => joined([change(isKorean(language) ? "제한" : "limit", row.p95_cpu_limits_mcores, row.recommended_limit_mcores, "mcores", language), change(isKorean(language) ? "요청" : "requests", row.p95_cpu_requests_mcores, row.recommended_request_mcores, "mcores", language)]);
const byDescending = (value) => (a, b) => (value(b) ?? 0) - (value(a) ?? 0);
// Enough for every domain to show up: at 16, a tenant with many workload findings left no host or
// disk saving in the list (rad60188).
const MAX_CANDIDATES = 24;
// One setting's change - a request finding shows the requests, a limit finding the limit: an
// increase-requests example led with its limit going down (rad60188, orbit-dm-fumo-primary-log-writer).
const settingChange = (kind, setting, row, language) => {
  const word = setting === "limit" ? (isKorean(language) ? "제한" : "limit") : isKorean(language) ? "요청" : "requests";
  if (kind === "memory") return setting === "limit" ? change(word, row.p95_limits_mib, row.recommended_limit_mib, "MiB", language) : change(word, row.p95_requests_mib, row.recommended_request_mib, "MiB", language);
  return setting === "limit" ? change(word, row.p95_cpu_limits_mcores, row.recommended_limit_mcores, "mcores", language) : change(word, row.p95_cpu_requests_mcores, row.recommended_request_mcores, "mcores", language);
};

/** The key-action candidates across every domain, risks first, then savings - each with its numbers. */
const rankActions = (byName, language, scope) => {
  const ko = isKorean(language);
  const tag = (domain) => "[" + DOMAINS.find((entry) => entry.domain === domain).short[language] + "] ";
  const on = (domain) => scope[domain] === true;
  const risks = [];
  const savings = [];
  const workloadGroup = (kind, finding) => (on("kubernetes") ? findingOf(byName[queryOfKind(kind)], finding) : undefined);
  // A finding's count names no cluster and no example: next to one example, the AI wrote "the 28 pods
  // of aia-cluster-test-pvc" for 28 workloads across the clusters (diw85600 test run).
  const groupLine = (kind, finding, group) => tag("kubernetes") + resourceWord(kind, language) + " · " + findingLabel(finding, language) + (ko ? " 워크로드 " + counted(group.count_workloads_with_finding, language) + " (모든 클러스터 합계): " : ": " + fmt(group.count_workloads_with_finding) + " workloads across all clusters: ") + meaningOf(kind, finding, language);

  // Risks: OOM kills, full disks, limits being hit, short hosts and clusters, saturated links.
  for (const row of examplesFor(workloadGroup("memory", "OOM_KILLS")).slice().sort(byDescending((row) => num(row.sum_oom_kills))).slice(0, 3)) {
    risks.push(tag("kubernetes") + workloadName(row) + (ko ? " - 메모리 OOMKill " + fmt(row.sum_oom_kills) + "회: " : " - " + fmt(row.sum_oom_kills) + " memory OOM kills: ") + memoryChange(row, language) + perPod(row, language));
  }
  if (on("disk")) {
    for (const row of firstNested(byName.disk_overutilized, "examples").slice(0, 3)) {
      risks.push(tag("disk") + String(row["dt.entity.host.name"]) + " " + String(row["dt.entity.disk.name"]) + (ko ? " - 30일 최대 사용률 " + fmt(row.max_disk_percent) + "%, 크기 " + fmt(row.disk_size_gib) + " GiB, 최소 여유 " + fmt(row.never_used_gib) + " GiB: 확장하거나 정리" : " - 30-day peak " + fmt(row.max_disk_percent) + "%, size " + fmt(row.disk_size_gib) + " GiB, least free " + fmt(row.never_used_gib) + " GiB: grow or clean up"));
    }
  }
  for (const row of examplesFor(workloadGroup("memory", "INCREASE_LIMITS")).slice().sort(byDescending((row) => num(row.p95_working_set_mib) / (num(row.p95_limits_mib) || 1))).slice(0, 2)) {
    // At the limit, the caveat goes with the advice: the key actions dropped it (rad60188, fluent-bit).
    const full = num(row.p95_limits_mib) > 0 && num(row.p95_working_set_mib) >= num(row.p95_limits_mib) * 0.99;
    const caveat = full ? (ko ? " - 작업 세트가 제한과 거의 같아 페이지 캐시일 수 있으니 올리기 전에 실제 필요량 확인" : " - the working set is almost at the limit and can be page cache, so check the actual need before raising it") : "";
    risks.push(tag("kubernetes") + workloadName(row) + (ko ? " - 메모리 작업 세트 " + fmt(row.p95_working_set_mib) + " / 제한 " + fmt(row.p95_limits_mib) + " MiB: " : " - memory working set " + fmt(row.p95_working_set_mib) + " of a " + fmt(row.p95_limits_mib) + " MiB limit: ") + memoryChange(row, language) + perPod(row, language) + caveat);
  }
  for (const row of examplesFor(workloadGroup("cpu", "INCREASE_LIMITS")).slice().sort(byDescending((row) => num(row.throttling_p95))).slice(0, 2)) {
    risks.push(tag("kubernetes") + workloadName(row) + (ko ? " - CPU 사용량 " + fmt(row.p95_cpu_usage_mcores) + " / 제한 " + fmt(row.p95_cpu_limits_mcores) + " mcores, 스로틀링 지표 " + fmt(row.throttling_p95) + ": " : " - CPU use " + fmt(row.p95_cpu_usage_mcores) + " of a " + fmt(row.p95_cpu_limits_mcores) + " mcores limit, throttling indicator " + fmt(row.throttling_p95) + ": ") + cpuChange(row, language) + perPod(row, language));
  }
  if (on("host")) {
    for (const group of firstNested(byName.host_utilization, "utilization_groups").filter((group) => group.utilization === "UNDERPROVISIONED")) {
      risks.push(tag("host") + hostGroupLabel(group, language) + " " + counted(group.count, language, "machine") + " (" + hostRange(group, language) + "): " + meaningOf("host", "UNDERPROVISIONED", language) + " " + (ko ? "예: " : "For example ") + someNames(hostNames(group), group.count, language));
    }
  }
  if (on("kubernetes")) {
    for (const cluster of examplesOf(byName.k8s_cluster_cpu).filter((cluster) => cluster.finding === "SCALE_UP")) {
      risks.push(tag("kubernetes") + String(cluster["k8s.cluster.name"]) + (ko ? " - 노드 " + counted(cluster.avg_node_count, language, "machine") + ", 최소 " + counted(cluster.minimum_nodes, language, "machine") + " 필요: 노드를 추가하세요" : " - " + fmt(cluster.avg_node_count) + " nodes, at least " + fmt(cluster.minimum_nodes) + " needed: add nodes"));
    }
  }
  const saturatedRows = on("network") && Array.isArray(byName.network_saturated_interfaces) ? byName.network_saturated_interfaces : [];
  if (saturatedRows.length > 0) {
    const rows = saturatedRows;
    risks.push(tag("network") + (ko ? "포화 인터페이스 " + counted(rows.length, language) + ": 회선 증설이나 트래픽 분산을 검토하세요. 예: " : rows.length + " saturated interfaces: consider an upgrade or rerouting. For example ") + someNames(rows.map((row) => String(row.device) + " " + String(row.interface)), rows.length, language));
  }
  for (const [kind, finding] of [["memory", "NO_LIMIT_SET"], ["memory", "NO_REQUESTS_SET"], ["cpu", "NO_REQUESTS_SET"], ["memory", "INCREASE_REQUESTS"], ["cpu", "INCREASE_REQUESTS"]]) {
    const group = workloadGroup(kind, finding);
    if (!group || !(num(group.count_workloads_with_finding) > 0)) continue;
    risks.push(groupLine(kind, finding, group));
  }

  // Savings: nodes, disk space, reserved capacity, idle hosts.
  if (on("kubernetes")) {
    const after = Array.isArray(byName.k8s_rightsizing) ? byName.k8s_rightsizing : [];
    for (const cluster of examplesOf(byName.k8s_cluster_cpu)) {
      const name = String(cluster["k8s.cluster.name"]);
      const resized = after.find((row) => row["k8s.cluster.name"] === name);
      const now = num(cluster.removable_nodes) ?? 0;
      const later = resized ? num(resized.removable_nodes_after) ?? 0 : 0;
      if (now <= 0 && later <= 0) continue;
      savings.push(tag("kubernetes") + name + (ko
        ? " - 노드 " + counted(cluster.avg_node_count, language, "machine") + ": 지금 최소 " + counted(cluster.minimum_nodes, language, "machine") + "로 " + counted(now, language, "machine") + " 축소 가능" + (resized ? ", Pod 요청을 권장값으로 바꾸면 최소 " + counted(resized.minimum_nodes_after, language, "machine") + "로 " + counted(later, language, "machine") + " 축소 가능" : "")
        : " - " + fmt(cluster.avg_node_count) + " nodes: at least " + fmt(cluster.minimum_nodes) + " needed now, so " + fmt(now) + " can go" + (resized ? "; with the recommended pod requests at least " + fmt(resized.minimum_nodes_after) + ", so " + fmt(later) + " can go" : "")));
    }
  }
  if (on("disk")) {
    for (const group of firstNested(byName.disk_underutilized, "groups").slice(0, 3)) {
      savings.push(tag("disk") + (ko ? String(group.mount) + " " + fmt(group.disk_size_gib) + " GiB 디스크 " + counted(group.disks, language) + " - 30일 최대 사용량 " + fmt(group.max_used_gib) + " GiB: " + fmt(group.recommended_size_gib) + " GiB로 줄이면 " + fmt(group.reclaimable_gib) + " GiB 회수" : String(group.mount) + ", " + fmt(group.disks) + " disks of " + fmt(group.disk_size_gib) + " GiB - 30-day peak " + fmt(group.max_used_gib) + " GiB: shrunk to " + fmt(group.recommended_size_gib) + " GiB, " + fmt(group.reclaimable_gib) + " GiB freed"));
    }
  }
  for (const kind of ["memory", "cpu"]) {
    const group = workloadGroup(kind, "REDUCE_REQUESTS");
    if (!group || !(num(group.count_workloads_with_finding) > 0)) continue;
    const requested = (row) => num(kind === "memory" ? row.p95_requests_mib : row.p95_cpu_requests_mcores);
    const recommended = (row) => num(kind === "memory" ? row.recommended_request_mib : row.recommended_request_mcores);
    const top = examplesFor(group).slice().sort(byDescending((row) => ((requested(row) ?? 0) - (recommended(row) ?? 0)) * (num(row.pods) ?? 1)))[0];
    // The largest reduction on its own line, as an item of its own.
    if (top) savings.push(tag("kubernetes") + workloadName(top) + " - " + resourceWord(kind, language) + " " + findingLabel("REDUCE_REQUESTS", language) + ": " + settingChange(kind, "requests", top, language) + perPod(top, language));
    savings.push(groupLine(kind, "REDUCE_REQUESTS", group));
  }
  if (on("host")) {
    for (const finding of ["UNUSED", "OVERPROVISIONED"]) {
      for (const group of firstNested(byName.host_utilization, "utilization_groups").filter((group) => group.utilization === finding)) {
        savings.push(tag("host") + hostGroupLabel(group, language) + " " + counted(group.count, language, "machine") + " (" + hostRange(group, language) + "): " + meaningOf("host", finding, language) + " " + (ko ? "예: " : "For example ") + someNames(hostNames(group), group.count, language));
      }
    }
  }
  const updownRows = on("network") && Array.isArray(byName[UPDOWN]) ? byName[UPDOWN] : [];
  if (updownRows.length > 0) {
    const rows = updownRows;
    savings.push(tag("network") + (ko ? "Up/Down 인터페이스 " + counted(rows.length, language) + ": 의도한 down인지 확인하세요. 예: " : rows.length + " up/down interfaces: check whether they are meant to be down. For example ") + someNames(rows.map((row) => String(row.parentDeviceName)), rows.length, language));
  }
  return risks.concat(savings).slice(0, MAX_CANDIDATES);
};

/**
 * The key actions without an AI answer: the first candidate of each domain, then the next in rank,
 * kept in rank order - the top five alone were all workloads on a tenant with many findings.
 */
const spreadPick = (candidates, count) => {
  const domainOf = (line) => line.slice(0, line.indexOf("]") + 1);
  const picked = [];
  for (const [index, line] of candidates.entries()) {
    if (picked.length < count && !picked.some((other) => domainOf(candidates[other]) === domainOf(line))) picked.push(index);
  }
  for (const [index] of candidates.entries()) {
    if (picked.length < count && !picked.includes(index)) picked.push(index);
  }
  return picked.sort((a, b) => a - b).map((index) => candidates[index]);
};

/** The resources the reports say can be freed, for under the key actions - from the data, not the AI. */
const resourcesLine = (byName, language, scope) => {
  const ko = isKorean(language);
  const parts = [];
  if (scope.kubernetes === true) {
    const after = Array.isArray(byName.k8s_rightsizing) ? byName.k8s_rightsizing : [];
    const nodes = after.filter((row) => (num(row.removable_nodes_after) ?? 0) > 0).map((row) => String(row["k8s.cluster.name"]) + " " + counted(row.removable_nodes_after, language, "machine"));
    if (nodes.length > 0) parts.push((ko ? "노드 " : "nodes ") + nodes.join(", ") + (ko ? " (Pod 요청 조정 후)" : " (after pod rightsizing)"));
  }
  if (scope.disk === true) {
    const total = num(Array.isArray(byName.disk_underutilized) ? byName.disk_underutilized[0]?.total_reclaimable_gib : null);
    if (total !== null && total > 0) parts.push((ko ? "디스크 " : "disk ") + fmt(total) + " GiB");
  }
  return parts.length > 0 ? "**" + (ko ? "확보 가능 자원" : "Resources that can be freed") + ":** " + parts.join(" · ") : "";
};
`;
