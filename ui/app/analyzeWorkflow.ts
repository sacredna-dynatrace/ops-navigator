import { getAppId, getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { workflowsClient, type Task, type Tasks, type WorkflowList } from "@dynatrace-sdk/client-automation";
import { businessEventsClient } from "@dynatrace-sdk/client-classic-environment-v2";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { sendIntent } from "@dynatrace-sdk/navigation";
import { linkifyEntities } from "./problemAnalysis";

/**
 * The Analyze Problem workflows: the Blast radius page's Analyze-problem prompt, answered by the
 * built-in SRE (incident) agent and posted as a problem annotation.
 *
 * Custom apps may not hold `automation:workflows:write` (the deploy is rejected: "Only apps that are
 * provided by Dynatrace can use ..."), nor is `run` known to be allowed, so the app never writes or
 * runs a workflow itself:
 * - it **creates** them through the Workflows app's `create-workflow` intent - the user saves;
 * - it **runs** one by ingesting a business event, which the on-demand workflow's event trigger
 *   picks up (the pattern the Cloud SRE Agents app uses);
 * - it **reads** the answer from Grail: the annotation is a `CUSTOM_ANNOTATION` event.
 * A workflow has one trigger, so there are two, built from the same tasks: `auto` (Davis problems)
 * and `onDemand` (the page's business event).
 */

/** Bump when the tasks change; the settings sheet then offers to create the new version. */
export const TEMPLATE_VERSION = 6;
export type WorkflowKind = "auto" | "onDemand";
export const WORKFLOW_TITLES: Record<WorkflowKind, string> = {
  auto: "Analyze Problem (auto)",
  onDemand: "Analyze Problem (on demand)",
};
/** Business event the page sends to run the on-demand workflow. */
export const REQUEST_EVENT_TYPE = "overview-dashboard.analyze-problem.request";
const AGENT_TASK = "call_agent";
const ERROR_TASK = "error_details_agent";
/** In the first task's script, so a saved workflow tells which template version it came from. */
const MARKER = (kind: WorkflowKind) => `overview-dashboard analyze-problem template v${TEMPLATE_VERSION} ${kind}`;
const MARKER_PATTERN = /overview-dashboard analyze-problem template v(\d+)/;

// Scripts run in the workflow's JavaScript runtime. They avoid template literals so this file can
// hold them in plain strings.
const resolveScript = (kind: WorkflowKind) => `// ${MARKER(kind)}
import { executionsClient } from "@dynatrace-sdk/client-automation";

// The problem to analyze: a Davis event (auto), the page's business event (on demand, problem_id
// field), or problem_id passed to a manual run.
export default async function ({ execution_id }) {
  const execution = await executionsClient.getExecution({ id: execution_id });
  const params = execution.params ?? {};
  const event = params.event ?? {};
  const displayId = String(event.display_id ?? event.problem_id ?? params.problem_id ?? "").trim();
  if (!/^P-\\d+$/.test(displayId)) {
    throw new Error("No Davis problem id in the trigger or the problem_id parameter (got '" + displayId + "').");
  }
  return { displayId };
}
`;

/**
 * Platform text an agent run returns when it hits a ceiling. The task still reports SUCCESS with this
 * as its answer, so it has to be caught by its text. "steps" came on P-2611383 (diw85600) and was
 * posted as the analysis, because only "tool calls" - the SRE Agent workflow's check - was caught.
 */
export const LIMIT_MESSAGES = ["maximum number of tool calls has been reached", "maximum number of steps has been reached"];
export const isLimitMessage = (text: string) => LIMIT_MESSAGES.some((message) => text.includes(message));

const ERROR_SCRIPT = `import { executionsClient } from "@dynatrace-sdk/client-automation";

const TASK = "${AGENT_TASK}";
// Platform text when an agent run hits a ceiling; the run reports SUCCESS with this as its result.
const LIMIT_MESSAGES = ${JSON.stringify(LIMIT_MESSAGES)};

export default async function ({ execution_id }) {
  const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: TASK });
  const text = task.result?.text ?? "";
  if (task.stateInfo) return task.errorReason ? task.errorReason + ": " + task.stateInfo : task.stateInfo;
  if (LIMIT_MESSAGES.some((message) => text.includes(message))) return "agent가 단계/도구 호출 한도에 도달해 분석을 끝내지 못했습니다";
  if (!text.trim()) return "엔진이 빈 응답을 반환했습니다";
  return "알 수 없는 오류 (stateInfo 없음)";
}
`;

/**
 * Drops the lead-in an agent writes before its report ("Now I have all the key evidence I need. Let
 * me compile the final report.") - asked not to, it still did on P-2611383 and P-2611388. Keeps
 * everything from the first heading, rule or bold line when that comes within the first five lines,
 * then any blank or rule lines left on top. CLEAN_SCRIPT runs the same rule in the workflow.
 */
export const cleanReport = (text: string): string => {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => /^\s*(#{1,6}\s|---\s*$|\*\*)/.test(line));
  let kept = first > 0 && first <= 5 ? lines.slice(first) : lines;
  while (kept.length > 0 && /^\s*(---)?\s*$/.test(kept[0])) kept = kept.slice(1);
  return kept.join("\n");
};

// String.raw keeps the regular expressions' backslashes as written; \x60 is a backtick.
const CLEAN_SCRIPT = String.raw`import { executionsClient } from "@dynatrace-sdk/client-automation";

// The agent's report without its lead-in sentence, with service and host ids turned into links - the
// same rules as cleanReport and linkifyEntities in the app.
const ROUTES = {
  "SERVICE-": ["/ui/apps/dynatrace.services/explorer/services", "perspective=performance", "detailsId="],
  "HOST-": ["/ui/apps/dynatrace.infraops/explorer/Compute/Hosts", "perspective=Health", "fullPageId="],
};
const PROTECTED = /(\x60\x60\x60[\s\S]*?\x60\x60\x60|\x60[^\x60\n]*\x60|\[[^\]\n]*\]\([^)\s]*\)|https?:\/\/[^\s)]+)/;
const LINKABLE_ID = /(?:\/ui\/entity\/)?\b((?:SERVICE|HOST)-[0-9A-F]{16})\b/g;

const clean = (text) => {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => /^\s*(#{1,6}\s|---\s*$|\*\*)/.test(line));
  let kept = first > 0 && first <= 5 ? lines.slice(first) : lines;
  while (kept.length > 0 && /^\s*(---)?\s*$/.test(kept[0])) kept = kept.slice(1);
  return kept.join("\n");
};

const linkify = (text, environmentUrl) => {
  const base = environmentUrl.replace(/\/$/, "");
  const link = (id) => {
    const route = ROUTES[id.startsWith("SERVICE-") ? "SERVICE-" : "HOST-"];
    return base + route[0] + "?" + route[1] + "&" + route[2] + encodeURIComponent(id);
  };
  return text.split(PROTECTED).map((part, index) => {
    if (index % 2 === 0) return part.replace(LINKABLE_ID, (match, id) => "[" + id + "](" + link(id) + ")");
    const classic = /\/ui\/entity\/((?:SERVICE|HOST)-[0-9A-F]{16})/.exec(part);
    if (classic && part.startsWith("[")) return part.replace(/^\[[^\]]*\]/, (label) => label.replace("/ui/entity/", "")).replace(/\]\([^)\s]*\)$/, "](" + link(classic[1]) + ")");
    if (classic) return link(classic[1]);
    const code = /^\x60((?:SERVICE|HOST)-[0-9A-F]{16})\x60$/.exec(part);
    return code ? "[" + part + "](" + link(code[1]) + ")" : part;
  }).join("");
};

export default async function ({ execution_id }) {
  const task = await executionsClient.getTaskExecution({ executionId: execution_id, id: "${AGENT_TASK}" });
  const prompt = await executionsClient.getTaskExecution({ executionId: execution_id, id: "build_prompt" });
  const text = clean(String(task.result?.text ?? ""));
  const environmentUrl = prompt.result?.environmentUrl;
  return { text: environmentUrl ? linkify(text, environmentUrl) : text };
}
`;

const FAIL_SCRIPT = `export default async function () {
  throw new Error("Analyze problem (SRE agent) failed - see the reason posted on the problem.");
}
`;

const AGENT_TEXT = `(result("${AGENT_TASK}")["text"] | default(""))`;
const HAS_ANSWER = `(${AGENT_TEXT} | trim | length) > 0 and not (${LIMIT_MESSAGES.map((message) => `"${message}" in ${AGENT_TEXT}`).join(" or ")})`;

/** Budget for the SRE agent only (run-agent's supplementary input). */
const AGENT_BUDGET = [
  "Hard budget: at most 12 tool calls in total. The run is cut off at its step limit and then returns nothing usable, so after about 10 calls stop investigating and write the complete report with what you have; an open verdict is better than no report.",
  // v4: the P-2611383 report opened with "이제 수집된 모든 데이터를 바탕으로 최종 보고서를 작성하겠습니다."
  "Start the answer directly with the Verdict heading: no planning, progress or transition sentence anywhere in it.",
].join(" ");

/** Annotation names: the page reads progress from them. */
export const ANNOTATION = {
  started: "Analyze problem (SRE agent) — 분석 시작",
  done: "Analyze problem (SRE agent)",
  failed: "Analyze problem (SRE agent) — 실패",
};

const annotation = (eventName: string, eventDescription: string) => ({
  problemId: '{{ result("build_prompt")["eventId"] }}',
  // One annotation per problem: every run replaces it, whichever workflow ran.
  annotationId: '{{ result("build_prompt")["eventId"] }}-analyze-agent',
  annotationSource: "Analyze Problem",
  eventName,
  eventDescription,
});

/**
 * The tasks, with the action of this app's own install (its id differs per tenant copy). Each task
 * carries its own key as `name`: the API fills it in, but the Workflows app's create-workflow intent
 * does not - sent without it, the editor opened with the trigger and no tasks at all.
 */
export const workflowTasks = (kind: WorkflowKind, appId: string = getAppId()): Tasks =>
  Object.fromEntries(Object.entries(taskDefinitions(kind, appId)).map(([name, task]) => [name, { name, ...task }]));

const taskDefinitions = (kind: WorkflowKind, appId: string): Record<string, Task> => ({
  resolve_problem: {
    action: "dynatrace.automations:run-javascript",
    description: "Finds the problem's display id - from the triggering event, or from problem_id on a manual run",
    input: { script: resolveScript(kind) },
    position: { x: 0, y: 1 },
    predecessors: [],
  },
  build_prompt: {
    action: `${appId}:build-analysis-prompt`,
    description: "Builds the Analyze problem prompt (problem facts, log scope, RUM or serverless branch)",
    input: { problemId: '{{ result("resolve_problem")["displayId"] }}', language: "Korean", timeZone: "Asia/Seoul" },
    position: { x: 0, y: 2 },
    predecessors: ["resolve_problem"],
    conditions: { states: { resolve_problem: "OK" } },
  },
  progress_agent: {
    action: "dynatrace.davis.problems:annotate-and-link",
    description: "Placeholder for the SRE agent's answer",
    input: annotation(ANNOTATION.started, "\u{1F50D} **Analyze problem** 분석이 진행 중입니다 (엔진: SRE agent)  \n⏳ 결과가 나오면 이 주석이 갱신됩니다"),
    position: { x: 0, y: 3 },
    predecessors: ["build_prompt"],
    conditions: { states: { build_prompt: "OK" } },
  },
  [AGENT_TASK]: {
    action: "dynatrace.davis.workflow.actions:run-agent",
    description: "The built-in SRE (incident) agent, answering the Analyze problem prompt",
    input: {
      agent: "dt-system-incident-agent",
      agentTemplate: "dt-system-incident-agent",
      agentType: "incident-agent",
      builtIn: true,
      prompt: '{{ result("build_prompt")["prompt"] }}',
      // The agent's own ceiling, enforced here rather than in the shared prompt: Assist answered the
      // same prompt on P-2611383 within its limits, the SRE agent ran out of steps.
      supplementary: AGENT_BUDGET,
    },
    position: { x: 0, y: 4 },
    predecessors: ["progress_agent"],
    conditions: { states: { progress_agent: "OK" } },
  },
  clean_report: {
    action: "dynatrace.automations:run-javascript",
    description: "Drops the agent's lead-in sentence before the report",
    input: { script: CLEAN_SCRIPT },
    position: { x: 0, y: 5 },
    predecessors: [AGENT_TASK],
    conditions: { states: { [AGENT_TASK]: "ANY" }, custom: `{{ ${HAS_ANSWER} }}` },
  },
  report_agent: {
    action: "dynatrace.davis.problems:annotate-and-link",
    description: "Replaces the placeholder with the SRE agent's answer",
    input: annotation(ANNOTATION.done, '{{ result("clean_report")["text"] }}'),
    position: { x: 0, y: 6 },
    predecessors: ["clean_report"],
    conditions: { states: { clean_report: "OK" } },
  },
  [ERROR_TASK]: {
    action: "dynatrace.automations:run-javascript",
    description: "Captures why the SRE agent produced no answer",
    input: { script: ERROR_SCRIPT },
    position: { x: 1, y: 5 },
    predecessors: [AGENT_TASK],
    conditions: { states: { [AGENT_TASK]: "ANY" }, custom: `{{ not (${HAS_ANSWER}) }}` },
  },
  error_annotation_agent: {
    action: "dynatrace.davis.problems:annotate-and-link",
    description: "Replaces the placeholder with the reason the SRE agent failed",
    input: annotation(ANNOTATION.failed, `❌ **Analyze problem 분석을 완료하지 못했습니다** (엔진: SRE agent)\n\n**사유:** {{ result("${ERROR_TASK}") }}`),
    position: { x: 1, y: 6 },
    predecessors: [ERROR_TASK],
    conditions: { states: { [ERROR_TASK]: "OK" } },
  },
  propagate_failure_agent: {
    action: "dynatrace.automations:run-javascript",
    description: "Fails the execution after the reason is posted, so it reports ERROR rather than SUCCESS",
    input: { script: FAIL_SCRIPT },
    position: { x: 1, y: 7 },
    predecessors: ["error_annotation_agent"],
    conditions: { states: { error_annotation_agent: "OK" } },
  },
});

/**
 * Triggers. `auto`: open ERROR and SLOWDOWN problems, ten minutes after they open, once Davis has
 * finished - the built-in SRE Agent workflow's conditions; created switched off, since a tenant
 * running that workflow would otherwise analyze every problem twice. `onDemand`: the page's business
 * event; on, because it only fires when someone asks. (On diw85600 an event ingested seconds after
 * the workflow was saved did not fire it; one a few minutes later did, within 10 s.)
 */
const triggers: Record<WorkflowKind, Record<string, unknown>> = {
  auto: {
    eventTrigger: {
      isActive: false,
      triggerConfiguration: {
        type: "davis-problem",
        value: {
          analysisReady: true,
          // Every category spelled out: the intent's editor treats a missing one as on, and showed
          // "availability, or error, or slowdown" for { error, slowdown }.
          categories: { monitoringUnavailable: false, availability: false, error: true, slowdown: true, resource: false, custom: false, info: false },
          customFilter: "dt.davis.is_duplicate == false",
          entityTags: {},
          entityTagsMatch: "all",
          maintenanceWindowTriggerBehavior: "always",
          onProblemClose: false,
          problemOpenDuration: 10,
        },
      },
    },
  },
  onDemand: {
    eventTrigger: {
      isActive: true,
      triggerConfiguration: { type: "event", value: { eventType: "bizevents", query: `event.type == "${REQUEST_EVENT_TYPE}"` } },
    },
  },
};

/**
 * Opens the Workflows app with the workflow filled in; the user reviews and saves it, as themselves.
 * Public, so every user of the app finds it.
 *
 * With `existingId` the intent carries that workflow's id, so saving should replace it in place
 * rather than add a second workflow - the app cannot delete the old one (no write scope). The intent
 * declares an optional `id` but documents no behaviour for it; the settings sheet still lists any
 * leftover versions with links, in case it creates a copy instead.
 */
export const openCreateWorkflow = (kind: WorkflowKind, existingId?: string) =>
  sendIntent(
    { ...(existingId ? { id: existingId } : {}), title: WORKFLOW_TITLES[kind], isPrivate: false, tasks: workflowTasks(kind), trigger: triggers[kind] } as never,
    { recommendedAppId: "dynatrace.automations", recommendedIntentId: "create-workflow" },
  );

export type WorkflowInfo = { id: string; title: string; active: boolean; version: number; outdated: boolean; actor: string | null };

const kindOf = (workflow: WorkflowList): WorkflowKind | null => {
  const config = workflow.trigger?.eventTrigger?.triggerConfiguration as { type?: string; value?: { query?: string } } | undefined;
  if (config?.type === "davis-problem") return "auto";
  if (config?.type === "event" && config.value?.query?.includes(REQUEST_EVENT_TYPE)) return "onDemand";
  return null;
};

export type FoundWorkflows = Partial<Record<WorkflowKind, WorkflowInfo>> & {
  /** Further Analyze Problem workflows - older versions or copies - to be deleted in the Workflows app. */
  others: (WorkflowInfo & { kind: WorkflowKind })[];
};

/**
 * The Analyze Problem workflows the user can see: one per kind - the active one, else the newest
 * version - and the rest as `others`. Needs `automation:workflows:read`; the caller treats a refusal
 * as "unknown". Recognized by title and trigger, so a workflow made with dtctl counts too.
 */
export const findWorkflows = async (): Promise<FoundWorkflows> => {
  const list = await workflowsClient.getWorkflows({ search: "Analyze Problem", limit: 50 });
  const all: (WorkflowInfo & { kind: WorkflowKind })[] = [];
  for (const workflow of list.results) {
    if (!workflow.title.startsWith("Analyze Problem")) continue;
    const kind = kindOf(workflow);
    if (!kind) continue;
    // The list omits task scripts; the version needs the full workflow.
    const full = await workflowsClient.getWorkflow({ id: workflow.id });
    const script = (full.tasks?.resolve_problem?.input as { script?: string } | undefined)?.script ?? "";
    const match = MARKER_PATTERN.exec(script);
    const version = match ? Number(match[1]) : 1;
    all.push({ kind, id: full.id, title: full.title, active: full.trigger?.eventTrigger?.isActive === true, version, outdated: version < TEMPLATE_VERSION, actor: full.actor ?? full.owner ?? null });
  }
  const better = (a: WorkflowInfo, b: WorkflowInfo) => (a.active !== b.active ? a.active : a.version > b.version);
  const found: FoundWorkflows = { others: [] };
  for (const info of all) {
    const current = found[info.kind];
    if (!current) { found[info.kind] = info; continue; }
    if (better(info, current)) { found.others.push({ ...current, kind: info.kind }); found[info.kind] = info; } else found.others.push(info);
  }
  return found;
};

/**
 * What a workflow must be granted in its Authorization settings (custom selection) for the SRE agent to
 * work. Checked on bby34718: with only ai:operator:execute the agent ran with no data tools and wrote a
 * [PARTIAL] report from the problem's metadata; with this list it queried spans, logs and metrics. The
 * user already held all of them - the Workflows app's "recommended" set asked for 137 unrelated ones
 * (credential vault, API tokens, ...) that are not needed.
 */
export const WORKFLOW_PERMISSIONS = [
  "ai:operator:execute", "mcp-gateway:servers:invoke", "mcp-gateway:servers:read", "document:documents:read",
  "storage:buckets:read", "storage:logs:read", "storage:metrics:read", "storage:spans:read",
  "storage:events:read", "storage:entities:read", "storage:smartscape:read", "storage:user.events:read",
];

/**
 * A report the agent wrote without data tools. It still SUCCEEDS; the agent marks it "[PARTIAL]" and says
 * it has no query tools. Matched loosely, so the page warns rather than calls it a failure.
 */
export const isPartialReport = (text: string) =>
  /\[PARTIAL\]|쿼리를 실행할 수 있는 도구|no (dql|query) tools?|cannot (run|execute) (dql|queries)/i.test(text);

/**
 * Link to a workflow in the Workflows app. Absolute, like the page's other links: the app runs in an
 * iframe on its own origin, where a relative `/ui/apps/...` link opened nothing.
 */
export const workflowLink = (id: string) => `${getEnvironmentUrl().replace(/\/$/, "")}/ui/apps/dynatrace.automations/workflows/${encodeURIComponent(id)}`;

/** Asks the on-demand workflow to analyze one problem. */
export const requestAnalysis = (displayId: string) =>
  businessEventsClient.ingest({
    type: "application/cloudevent+json",
    body: {
      specversion: "1.0",
      id: crypto.randomUUID(),
      source: getAppId(),
      type: REQUEST_EVENT_TYPE,
      data: { problem_id: displayId },
    },
  });

/** Davis problem event ids look like `-7737997126529606279_1793763060000V2`; nothing else goes into DQL. */
const EVENT_ID = /^-?\d+_\d+V2$/;

export type AnnotationState = { kind: "none" } | { kind: "started" | "done" | "failed"; at: number; text: string };

/**
 * The latest analysis annotation of a problem, from Grail: whichever workflow ran last - auto or on
 * demand - wrote it under the same annotation id.
 */
export const readAnnotation = async (eventId: string): Promise<AnnotationState> => {
  if (!EVENT_ID.test(eventId)) return { kind: "none" };
  const response = await queryExecutionClient.queryExecute({
    body: {
      query: `fetch events, from: now() - 30d
| filter event.type == "CUSTOM_ANNOTATION" and annotation.id == "${eventId}-analyze-agent"
| sort timestamp desc
| limit 1
| fields timestamp, name = event.name, text = event.description`,
      requestTimeoutMilliseconds: 30_000,
    },
  });
  let result = response;
  while (result.state === "RUNNING" && result.requestToken) {
    result = await queryExecutionClient.queryPoll({ requestToken: result.requestToken, requestTimeoutMilliseconds: 10_000 });
  }
  const record = result.result?.records?.[0] as { timestamp?: unknown; name?: unknown; text?: unknown } | undefined;
  if (!record) return { kind: "none" };
  const name = typeof record.name === "string" ? record.name : "";
  const text = typeof record.text === "string" ? record.text : "";
  const at = Date.parse(String(record.timestamp));
  // A limit message posted as the answer by a workflow older than v3 is a failure too.
  const kind = name === ANNOTATION.started ? "started" : name === ANNOTATION.failed || isLimitMessage(text) ? "failed" : "done";
  // Older annotations get the same treatment as new ones: lead-in dropped, entity ids linked.
  return { kind, at: Number.isFinite(at) ? at : 0, text: kind === "done" ? linkifyEntities(cleanReport(text), getEnvironmentUrl()) : text };
};
