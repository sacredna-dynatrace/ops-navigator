/**
 * "Analyze problem" without the browser: the problem facts, the log scope and the prompt.
 *
 * Shared by the Blast radius page (which sends the prompt to Dynatrace Assist) and the
 * `build-analysis-prompt` workflow action (which hands it to an AI task in a workflow), so a problem
 * analyzed from either place gets the same prompt. Keep this file free of imports: the action
 * bundles it into the Dynatrace JavaScript runtime, where browser and React modules do not exist.
 */

type DqlRecord = Record<string, unknown>;

/**
 * How a problem's origin reads, from what Davis recorded (verified on isb54165, 30 days):
 * - `root`: Davis named a root cause (660 of 1,624).
 * - `self`: no root cause and a single affected entity (955 - 99% of the rest). Nothing spread to
 *   it from elsewhere; the problem is that entity's own, so it is drawn as the origin.
 * - `events`: no root cause and several affected entities (about 9). Davis grouped concurrent
 *   events - usually one process failing on several hosts - without linking them causally, so they
 *   are drawn as events around the problem, not as an impact chain.
 */
export type ProblemOrigin = "root" | "self" | "events";

/** One Davis problem, collapsed from its state-change records. */
export type AnalysisProblem = {
  displayId: string;
  /** What the Problems app opens a problem by (`…V2`), unlike the `P-…` display id. */
  eventId: string;
  title: string;
  category: string;
  active: boolean;
  start: string;
  end: string;
  /** Davis root-cause entity, when the analysis found one (about 40% of problems on the reference tenant). */
  rootId: string | null;
  rootName: string | null;
  /** Entities Davis confirmed as affected, with the names Davis recorded for them. */
  affected: { id: string; name: string }[];
  /**
   * Null when Davis did not estimate it - not the same as zero. Comes from RUM Classic, which the
   * Smartscape FRONTEND nodes and `dt.frontend.*` metrics do not show, so it can be set on a tenant
   * where the topology has no RUM column.
   */
  users: number | null;
  origin: ProblemOrigin;
  /** The entity the rings grow from: the root cause, or the single affected entity of a self problem. */
  originId: string | null;
  originName: string | null;
  /** Distinct hosts Davis attached to the problem, for describing concurrent events. */
  hostCount: number;
  /** Those hosts' ids, distinct. Infrastructure entities without a page of their own link to the host when there is exactly one. */
  hostIds: string[];
  /**
   * Where the problem's logs live, as Davis recorded it: Kubernetes namespaces, workloads and
   * clusters, and process groups. Logs here carry no service id (none of a 15-minute sample on
   * isb54165 did), so these are what an Assist log query has to filter on. Empty for problems
   * Davis tied only to services.
   */
  scope: { namespaces: string[]; workloads: string[]; clusters: string[]; processGroups: string[] };
};

/**
 * Davis writes one record per state change, so every field is taken from the problem's latest
 * record and the problem is keyed by `display_id`. Used by the page's problem list and by the
 * action's single-problem query, so both read a problem the same way.
 */
export const PROBLEM_SUMMARIZE = `| summarize {
    event_id = takeLast(event.id), title = takeLast(event.name), category = takeLast(event.category), status = takeLast(event.status),
    start = min(event.start), end = max(event.end),
    root = takeLast(root_cause_entity_id), root_name = takeLast(root_cause_entity_name),
    affected = takeLast(affected_entity_ids), affected_names = takeLast(affected_entity_names),
    users = takeLast(dt.davis.affected_users_count), hosts = takeLast(dt.entity.host),
    k8s_namespaces = takeLast(k8s.namespace.name), k8s_workloads = takeLast(k8s.workload.name),
    k8s_clusters = takeLast(k8s.cluster.name), process_groups = takeLast(dt.entity.process_group),
    entity_tags = takeLast(entity_tags)
  }, by: { display_id }
| fieldsAdd host_count = arraySize(arrayDistinct(hosts))
| fieldsAdd n_affected = arraySize(affected), active = status == "ACTIVE"`;

/** Davis display ids look like `P-2610782`; anything else is not interpolated into DQL. */
export const DISPLAY_ID = /^P-\d+$/;
/** Classic entity ids (`SERVICE-1A2B…`); anything else is not interpolated into DQL. */
const ENTITY_ID = /^[A-Z_]+-[0-9A-F]+$/;

/**
 * One problem by display id, for the workflow action. Seven days back, as in the SRE Agent: a
 * workflow fires minutes after a problem opens, and a manual run is for a recent one.
 */
export const problemFactsQuery = (displayId: string) => {
  if (!DISPLAY_ID.test(displayId)) throw new Error(`Not a Davis display id: ${displayId}`);
  return `fetch dt.davis.problems, from: now() - 7d
| filter display_id == "${displayId}" and dt.davis.is_duplicate == false
${PROBLEM_SUMMARIZE}`;
};

/**
 * The hosts the given services run on, for the log scope. Seven days, not the problem window: on
 * diw85600 `fetch dt.entity.service, from: now() - 2h` returned none of the services a 7-day window
 * found, with no error.
 */
export const serviceHostsQuery = (serviceIds: string[]) => {
  const ids = serviceIds.filter((id) => ENTITY_ID.test(id));
  if (ids.length === 0) return null;
  return `fetch dt.entity.service, from: now() - 7d
| filter in(id, array(${ids.map((id) => `"${id}"`).join(", ")}))
| fields id, hosts = runs_on[dt.entity.host]`;
};

export const text = (record: DqlRecord, field: string): string => {
  const value = record[field];
  return typeof value === "string" ? value : "";
};
export const strings = (record: DqlRecord, field: string): string[] => {
  const value = record[field];
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean) : [];
};
export const optionalNumber = (record: DqlRecord, field: string): number | null => {
  const value = record[field];
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** A `PROBLEM_SUMMARIZE` record as a problem; null when it has no display id. */
export const problemFromRecord = (record: DqlRecord): AnalysisProblem | null => {
  const displayId = text(record, "display_id");
  if (!displayId) return null;
  const ids = strings(record, "affected");
  const names = strings(record, "affected_names");
  // Davis records names alongside ids; fall back to the id where it did not.
  const affected = ids.map((id, index) => ({ id, name: names[index] || id }));
  const rootId = text(record, "root") || null;
  const rootName = text(record, "root_name") || null;
  const origin: ProblemOrigin = rootId ? "root" : affected.length === 1 ? "self" : "events";
  return {
    displayId,
    eventId: text(record, "event_id"),
    title: text(record, "title") || displayId,
    category: text(record, "category") || "OTHER",
    active: record.active === true || record.active === "true",
    start: text(record, "start"),
    end: text(record, "end"),
    rootId,
    rootName,
    affected,
    users: optionalNumber(record, "users"),
    origin,
    originId: origin === "root" ? rootId : origin === "self" ? affected[0].id : null,
    originName: origin === "root" ? rootName : origin === "self" ? affected[0].name : null,
    hostCount: optionalNumber(record, "host_count") ?? 0,
    hostIds: [...new Set(strings(record, "hosts"))],
    scope: {
      namespaces: strings(record, "k8s_namespaces"),
      workloads: strings(record, "k8s_workloads"),
      clusters: strings(record, "k8s_clusters"),
      processGroups: strings(record, "process_groups"),
    },
  };
};

/** The services among the problem's origin and affected entities, whose hosts widen the log scope. */
export const scopeServiceIds = (problem: AnalysisProblem): string[] =>
  [problem.originId, ...problem.affected.map((entity) => entity.id)].filter((id): id is string => Boolean(id?.startsWith("SERVICE-")));

/** The problem's log scope: what Davis recorded, plus affected hosts and the hosts its services run on. */
export const logScopeOf = (problem: AnalysisProblem, hostsOf: (serviceId: string) => string[] | undefined): LogScope => {
  const placed = scopeServiceIds(problem).flatMap((id) => hostsOf(id) ?? []);
  const ids = (prefix: string) => problem.affected.map((entity) => entity.id).filter((id) => id.startsWith(prefix));
  return {
    ...problem.scope,
    hosts: [...ids("HOST-"), ...placed],
  };
};

/**
 * How far before the problem's start Assist is asked to look: long enough to catch the deployment,
 * restart or saturation that led into it, short enough to keep the log and trace queries it runs
 * cheap. Asking for "all relevant data" without a window invites broad scans.
 */
export const ANALYSIS_LEAD_MINUTES = 30;

/** Minute precision in UTC, the way Assist and DQL read timestamps. */
const isoMinute = (time: number) => `${new Date(time).toISOString().slice(0, 16)}Z`;

/** "UTC+09:00" for the zone at that moment, so daylight saving is right; null if it cannot be read. */
const utcOffset = (time: number, zone: string): string | null => {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(time)
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name) return null;
    // "GMT" alone is a zero offset; otherwise "GMT+09:00".
    return name === "GMT" ? "UTC+00:00" : name.replace(/^GMT/, "UTC");
  } catch {
    return null;
  }
};

/**
 * Where to look for a problem's logs. Names for Kubernetes (logs carry them, not ids), ids for the
 * rest. Two Assist runs on one problem reached different root causes because one filtered logs by
 * `dt.entity.service` - which logs here do not carry - got zero records and concluded there were no
 * errors, while the other filtered by namespace and found 1,671. Naming the scope makes every run
 * look in the same place.
 */
export type LogScope = {
  namespaces: string[];
  workloads: string[];
  clusters: string[];
  processGroups: string[];
  hosts: string[];
};
/** Values per scope field and affected entities named; the rest are counted. */
const LIST_LIMIT = 5;
const list = (values: string[]) => {
  const unique = [...new Set(values)].filter(Boolean);
  return `${unique.slice(0, LIST_LIMIT).join(", ")}${unique.length > LIST_LIMIT ? ` (+${unique.length - LIST_LIMIT} more)` : ""}`;
};

/**
 * The one most specific log scope: Kubernetes namespace and workload, else process group, else host.
 * Listing several scopes let Assist pick any of them, and a broad one - a host - pulls in unrelated
 * logs and a different conclusion. Process instances are left out: they point at the same logs as
 * their process group in ids twice as long.
 */
const logScope = (scope: LogScope): string | null => {
  if (scope.namespaces.length > 0) {
    return [`k8s.namespace.name in (${list(scope.namespaces)})`, scope.workloads.length > 0 ? `k8s.workload.name in (${list(scope.workloads)})` : ""].filter(Boolean).join(" and ");
  }
  if (scope.processGroups.length > 0) return `dt.entity.process_group in (${list(scope.processGroups)})`;
  if (scope.hosts.length > 0) return `dt.entity.host in (${list(scope.hosts)})`;
  return null;
};

/**
 * The question sent to Assist, kept short and rule-shaped.
 *
 * It carries what the page already knows, so Assist does not have to rediscover it (with only the
 * display id it first searched the last 72 hours and missed). Times stay in UTC, which Assist queries
 * with; the answer is asked for in the browser's zone. Error logs come first because, between two runs
 * on one problem, they were what decided the root cause. Entities go by id only: names are free text,
 * and "Netty on 0:0:0:0:0:0:0:0:*" got the whole prompt rejected by Assist's PII blocking.
 * Kubernetes namespace and workload names are the exception - logs carry no ids for them.
 */
/**
 * Links an answer may use, built here rather than described to the model. With "relative paths
 * (/ui/entity/ENTITY-ID, .../problem/P-ID)" in the prompt, every evidence link in the reports failed on
 * diw85600 and bby34718: the Problems app opens a problem by its event id, not the P- display id, and
 * /ui/entity/ is a classic route that shows an empty page. Routes are the page's verified ones
 * (TileLinks.ts), assembled from parts because the no-secrets lint reads a long mixed-case URL as a
 * secret. Absolute, since a relative link opens on the app's own origin.
 */
const PROBLEMS_APP = ["ui", "apps", "dynatrace.davis.problems", "problem"].join("/");
const ENTITY_ROUTES: { prefix: string; path: string; query: string }[] = [
  { prefix: "SERVICE-", path: ["ui", "apps", "dynatrace.services", "explorer", "services"].join("/"), query: ["perspective=performance", "detailsId="].join("&") },
  { prefix: "HOST-", path: ["ui", "apps", "dynatrace.infraops", "explorer", "Compute", "Hosts"].join("/"), query: ["perspective=Health", "fullPageId="].join("&") },
];
const base = (environmentUrl: string) => environmentUrl.replace(/\/$/, "");
export const problemLink = (environmentUrl: string, eventId: string) => `${base(environmentUrl)}/${PROBLEMS_APP}/${encodeURIComponent(eventId)}`;
/** A link for a service or host; null for types without a verified route (process groups, workloads, ...). */
export const entityLink = (environmentUrl: string, entityId: string): string | null => {
  const route = ENTITY_ROUTES.find((candidate) => entityId.startsWith(candidate.prefix));
  return route ? `${base(environmentUrl)}/${route.path}?${route.query}${encodeURIComponent(entityId)}` : null;
};

/**
 * Only problem links go into the prompt - paths, no query string. Entity links need query parameters
 * (fullPageId=HOST-..., perspective=Health), and Assist rejected a whole prompt over them: "Potentially
 * sensitive data detected: URL_PARAM_VALUE" (P-2611453, diw85600). Entities stay plain ids; the
 * workflow's clean_report task and the page turn them into links afterwards (linkifyEntities).
 */
const linkLines = (problem: AnalysisProblem, environmentUrl: string | null): string[] => {
  if (!environmentUrl) return ["Links: give entity and problem ids as plain text, without links."];
  return [
    "Evidence links: give every entity (service, host, process group, workload, ...) as its plain id, with no link. Link problems only, like this:",
    problem.eventId ? `- ${problem.displayId}: ${problemLink(environmentUrl, problem.eventId)}` : "",
    `- Any other problem (e.g. a recurrence): ${base(environmentUrl)}/${PROBLEMS_APP}/EVENT_ID, with EVENT_ID its event.id from dt.davis.problems (fetch it with display_id). Never link a P- display id: the Problems app does not open it.`,
  ].filter(Boolean);
};

/** Classic service and host ids: 16 hex digits. */
const LINKABLE_ID = /(?:\/ui\/entity\/)?\b((?:SERVICE|HOST)-[0-9A-F]{16})\b/g;
/** Code blocks, code spans, markdown links and bare URLs: left as they are, except the cases below. */
const PROTECTED = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\)|https?:\/\/[^\s)]+)/;

/**
 * Turns service and host ids in an answer into links to their pages: bare ids, ids alone in a code
 * span, and old classic links (/ui/entity/ID, which render an empty page). Other ids and links are
 * left alone. CLEAN_SCRIPT in analyzeWorkflow.ts runs the same rule in the workflow.
 */
export const linkifyEntities = (text: string, environmentUrl: string): string => {
  const link = (id: string) => entityLink(environmentUrl, id) ?? "";
  return text.split(PROTECTED).map((part, index) => {
    if (index % 2 === 0) return part.replace(LINKABLE_ID, (_match, id: string) => `[${id}](${link(id)})`);
    const classic = /\/ui\/entity\/((?:SERVICE|HOST)-[0-9A-F]{16})/.exec(part);
    if (classic && part.startsWith("[")) return part.replace(/^\[[^\]]*\]/, (label) => label.replace("/ui/entity/", "")).replace(/\]\([^)\s]*\)$/, `](${link(classic[1])})`);
    if (classic) return link(classic[1]);
    const code = /^`((?:SERVICE|HOST)-[0-9A-F]{16})`$/.exec(part);
    return code ? `[${part}](${link(code[1])})` : part;
  }).join("");
};

export const explainPrompt = (problem: AnalysisProblem, language: string | null, scope: LogScope, zone: string | null, environmentUrl: string | null = null): string => {
  const start = Date.parse(problem.start);
  const end = Date.parse(problem.end);
  const hasWindow = Number.isFinite(start);
  const until = problem.active ? "ongoing" : isoMinute(Number.isFinite(end) ? end : start);
  const offset = zone && hasWindow ? utcOffset(start, zone) : null;
  const origin = problem.origin === "root" && problem.rootId
    ? `Root cause per Davis: ${problem.rootId}.`
    : problem.origin === "self" && problem.originId
      ? `Origin: ${problem.originId} itself (Davis found no cause elsewhere).`
      : "Davis grouped concurrent events with no causal link.";
  const affected = problem.affected.length > 0 ? `Affected: ${list(problem.affected.map((entity) => entity.id))}.` : "";
  const where = logScope(scope);
  /**
   * A problem on a web application is answered by RUM data, not logs. Sent the log-first prompt,
   * Assist searched logs that carry no frontend id, then guessed a dt.rum.* metric, and reported no
   * RUM data - while user.events held 479 errors for that app in the window and
   * dt.frontend.user_action.duration had risen to 4.9 s (bby34718).
   */
  const apps = [...new Set([problem.originId ?? "", ...problem.affected.map((entity) => entity.id)].filter((id) => id.startsWith("APPLICATION-")))];
  const rum = apps.length > 0;
  const sources = rum
    ? [`Steps: 1) fetch user.events where dt.rum.application.entity in (${list(apps)}), 2) dt.frontend.* metrics, 3) the backend services it calls.`]
    : [
      // With no scope, "find the hosts or namespaces first" sent Assist hunting for a scope that did
      // not exist: P-2610895 on bby34718 was an AWS Lambda function (no host, process or tag, no
      // spans of its own, no logs), and the run hit Assist's tool-call limit before answering.
      ...(where
        ? [
          "Steps: 1) error logs first, 2) then metrics, traces and events.",
          `Logs: filter by ${where} - logs here have no dt.entity.service.`,
          "Errors = loglevel ERROR/SEVERE/CRITICAL/ALERT/EMERGENCY, or content with exception/error/failed/timeout at any level.",
        ]
        : ["Steps: 1) service metrics, 2) callers' client spans, 3) events. No host, process or Kubernetes scope is known - it may be serverless (e.g. AWS Lambda); skip logs unless one check finds them."]),
    ];
  return [
    `Analyze Davis problem ${problem.displayId} "${problem.title}"${hasWindow ? `, ${isoMinute(start)} to ${until}` : ""}.`,
    `${origin} ${affected}`.trim(),
    hasWindow ? `Window: ${isoMinute(start - ANALYSIS_LEAD_MINUTES * 60_000)} (${ANALYSIS_LEAD_MINUTES} min before start) to ${problem.active ? "now" : "end"}.` : "",
    ...sources,
    // Assist guessed names that do not exist - status.code on spans, dt.service.request.failure_rate,
    // dt.rum.* metrics, event.start on user.events - got zero rows without an error and reported "no
    // data". Names differ per tenant, so the prompt says how to look them up rather than listing them
    // all; each method was checked on bby34718, isb54165 and diw85600. fieldsSummary is ruled out: it
    // counts records, and reported the absent event.start on all 14,922. A one-record sample fails too,
    // because span.status_code is set only on failed spans. No angle brackets: the Assist panel strips
    // them as markup, and "isNotNull(<field>)" arrived as "isNotNull()".
    // A budget, as in the SRE Agent prompt: Assist stops at its tool-call limit with no answer at all.
    "Use about 10 queries, in the step order; when calls run low, answer with what you have. Use entity ids as given - do not look up names unless the answer needs them.",
    // Checked only on a 0-row result: verifying every name up front cost calls the analysis needed.
    "A wrong field or metric name returns 0 rows without an error. Only when a query returns 0 rows, check the name before treating it as evidence:",
    "- Fields: fetch the source in the window | limit 1 | fieldsKeep \"*keyword*\".",
    "- Values: countIf(isNotNull(fieldname)) over the window - not fieldsSummary (counts records, so absent fields look full), not a 1-record sample.",
    `- Metrics and dimensions: fetch metric.series | filter startsWith(metric.key, "${rum ? "dt.frontend." : "dt.service."}").`,
    // Verified facts that Assist got wrong. The external-service one: a 94% failing "service"
    // (mdpt.co.kr) had no spans in three days - it is a domain the app calls, seen only as client spans
    // on the caller, and its name was only in the classic model.
    // P-2611388: the SRE agent sampled failed spans with a limit, reported ":9079 - 2 POST spans" and
    // missed 1,547 failed calls to one external IP that started before the scan it blamed; and it put
    // per-minute counts two minutes late, which made the scan look like the cause.
    "Failed spans: count them over the whole window for every affected service, grouped by server.address (summarize count()) - never judge from a limited sample. Timeseries values belong to the start of their interval: report each value at its bucket's start time.",
    `Known here: ${[
      rum ? "user.events time = start_time" : "",
      "failed span = span.status_code == \"error\" or request.is_failed == true",
      "failure rate = dt.service.request.failure_count / dt.service.request.count",
      // Lambda: faas.invoked_name and server.address lambda.<region>.amazonaws.com on the callers' client spans (bby34718).
      "services with no process - external WEB_REQUEST_SERVICE or AWS Lambda - have no spans of their own: their calls are client spans on the callers, by server.address or faas.invoked_name (the Lambda function name)",
      "names missing from Smartscape are in dt.entity.*",
    ].filter(Boolean).join("; ")}.`,
    // From the SRE Agent's Dynatrace Intelligence prompt. Recurrence decides most custom threshold
    // alerts here: "(ALL) Host CPU 사용량 높음(>90 %)" fires many times a day on isb54165.
    // Seven days, with start times: on diw85600 "Failure rate increase" fired daily at 03:26-03:36 UTC
    // on four days running (P-261110 ... P-2611156), and with 48h both engines called P-2611156 a real
    // outage. Duplicates are excluded: one engine cited the duplicate P-2611158 as a recurrence.
    // Any affected entity, not the root cause: on P-2611156 the SRE agent filtered by the root
    // (SERVICE-52AC…), found 2 problems a week apart and called it weekly - the alert fired daily, on
    // CustomerFrontendREST every day, with a different root cause on most days.
    "If calls remain, also check: how often this alert name fired in the last 7 days on any of the affected entities above - not only the root cause, which can differ from day to day (fetch dt.davis.problems, same event.name, dt.davis.is_duplicate == false, expand affected_entity_ids, keep those ids; list the problem ids with their start times) - the same alert at about the same time of day on several days points to a scheduled job or test scenario; for a threshold alert, the triggering metric's own time series, not its description.",
    "Judge whether it needs attention: synthetic, test-origin, or steadily recurring alerts with no correlating logs are noise - say so.",
    "Answer: start with a one-sentence Verdict (kind of problem, what is happening, which entity, since when); then checks run (filter, range, record count incl. 0); timeline from the earliest anomaly; root cause with evidence and DQL; impact; remediation; prevention; evidence links from the list below. Say so if the data does not support a conclusion.",
    ...linkLines(problem, environmentUrl),
    // A workflow keeps only the agent's last message. On P-2611156 (diw85600) the SRE agent wrote its
    // report, then closed with "위 보고서가 최종 분석 결과입니다" and a summary - and the annotation got
    // the 592-character summary, not the report. The SRE Agent workflow's prompt guards the same way.
    "Write the whole answer as one final message: it is read on its own, so never refer to an earlier message or a report 'above', and add no closing summary after it.",
    // Assist wrote "03:25 KST" for 03:25 UTC (12:25 KST) in its verdict and labelled UTC log times as
    // KST (P-2611156). DQL returns UTC, so the conversion has to be asked for explicitly.
    zone ? `Give every time in ${zone}${offset ? ` (${offset})` : ""} with its zone label, including times of day in prose such as a daily pattern. Query results are in UTC: convert each one before labelling it${offset ? ` (add ${offset.replace("UTC", "")})` : ""}, and never put the ${zone} label on a UTC value.` : "",
    language ? `Answer in ${language}.` : "",
  ].filter(Boolean).join("\n");
};
