import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { executionsClient, workflowsClient } from "@dynatrace-sdk/client-automation";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import {
  INFRA_MARKER_PATTERN,
  CLEANUP_TASK,
  INFRA_DOMAINS,
  INFRA_TEMPLATE_VERSION,
  INFRA_WORKFLOW_SEARCH,
  NOTEBOOK_TASK,
  infraOptimizationWorkflow,
  summarizeInfraInput,
  type InfraDomain,
  type InfraOptimizationInput,
} from "./infraOptimizationWorkflow";
import {
  CHECK_TASK,
  GITHUB_MARKER_PATTERN,
  GITHUB_TEMPLATE_VERSION,
  GITHUB_WORKFLOW_SEARCH,
  ISSUE_TASK,
  RESOLVE_TASK,
  githubIssueWorkflow,
  summarizeGithubTasks,
  type GithubIssueInput,
} from "./githubIssueWorkflow";

/**
 * The Automation page's workflows. Like the Analyze Problem ones (analyzeWorkflow.ts) the app cannot
 * write workflows: it links to the Workflows app's create-workflow intent with the definition filled
 * in, and the user saves it. The intent takes `input`, `isPrivate` and `hourlyExecutionLimit` - checked
 * on diw85600 with a workflow saved from it - but no description or guide.
 *
 * A link rather than sendIntent, so the editor opens in a new tab and this page stays where it was;
 * the page reloads its list when the tab comes back.
 */
export const createInfraWorkflowLink = (input: InfraOptimizationInput) =>
  getIntentLink(infraOptimizationWorkflow(input), "dynatrace.automations", "create-workflow");

/** The same, for the Problem → GitHub Issue workflow. */
export const createGithubWorkflowLink = (input: GithubIssueInput) =>
  getIntentLink(githubIssueWorkflow(input), "dynatrace.automations", "create-workflow");

const base = () => getEnvironmentUrl().replace(/\/$/, "");
/** A run in the Workflows app. */
export const executionLink = (id: string) => `${base()}/ui/apps/dynatrace.automations/executions/${encodeURIComponent(id)}`;

/** `cleaned`: older versions the run moved to the trash; `cleanupFailed`: ones it could not. */
/** `issueUrl`: the issue the run filed, or found already filed (GitHub workflow only). */
export type LastRun = { id: string; state: string; startedAt: string | null; notebookUrl: string | null; issueUrl: string | null; cleaned: number; cleanupFailed: number };

export type CreatedWorkflow = {
  id: string;
  title: string;
  version: number;
  outdated: boolean;
  isPrivate: boolean;
  /** False for a draft: saved from the create intent but not deployed, so a schedule would not fire. */
  deployed: boolean;
  /** "Manual", "Schedule", "Event" - as the API names it. */
  triggerType: string;
  /** The saved input in one line, or null when it no longer has this template's shape. */
  settings: string | null;
  lastRun: LastRun | null;
};

/** A task's result in a run, or null when it was skipped, failed or is not in that version. */
const taskResult = async (executionId: string, task: string): Promise<Record<string, unknown> | null> => {
  try {
    const execution = await executionsClient.getTaskExecution({ executionId, id: task });
    const result: unknown = execution.result;
    return typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const lastRunOf = async (last: { id: string; state: string; startedAt?: Date }): Promise<LastRun> => {
  const done = last.state === "SUCCESS";
  const [notebook, cleanup] = done ? await Promise.all([taskResult(last.id, NOTEBOOK_TASK), taskResult(last.id, CLEANUP_TASK)]) : [null, null];
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  return {
    id: last.id,
    state: last.state,
    startedAt: last.startedAt ? new Date(last.startedAt).toISOString() : null,
    notebookUrl: typeof notebook?.url === "string" ? notebook.url : null,
    issueUrl: null,
    cleaned: count(cleanup?.deleted),
    cleanupFailed: count(cleanup?.failed),
  };
};

/**
 * The Infrastructure Optimization workflows this app made that the user can see, newest template
 * first. Recognized by the marker in the notebook task, not the title: v1-v2 carried the title of
 * Dynatrace's own template, which has no marker and is not counted. Needs `automation:workflows:read`; the caller treats a refusal as "unknown".
 */
export const findInfraWorkflows = async (): Promise<CreatedWorkflow[]> => {
  const list = await workflowsClient.getWorkflows({ search: INFRA_WORKFLOW_SEARCH, limit: 50 });
  const found: CreatedWorkflow[] = [];
  for (const workflow of list.results) {
    // The list omits task inputs; the marker needs the full workflow.
    const full = await workflowsClient.getWorkflow({ id: workflow.id });
    const script = (full.tasks?.[NOTEBOOK_TASK]?.input as { script?: string } | undefined)?.script ?? "";
    const match = INFRA_MARKER_PATTERN.exec(script);
    if (!match) continue;
    const version = Number(match[1]);
    const last = full.lastExecution;
    found.push({
      id: full.id,
      title: full.title,
      version,
      outdated: version < INFRA_TEMPLATE_VERSION,
      isPrivate: full.isPrivate === true,
      deployed: full.isDeployed === true,
      triggerType: full.triggerType,
      settings: summarizeInfraInput(full.input),
      lastRun: last ? await lastRunOf(last) : null,
    });
  }
  return found.sort((a, b) => b.version - a.version);
};

const issueRunOf = async (last: { id: string; state: string; startedAt?: Date }): Promise<LastRun> => {
  const [issue, check] = await Promise.all([taskResult(last.id, ISSUE_TASK), taskResult(last.id, CHECK_TASK)]);
  const filed = (issue?.issue as { html_url?: unknown } | undefined)?.html_url;
  const existing = check?.existing;
  return {
    id: last.id,
    state: last.state,
    startedAt: last.startedAt ? new Date(last.startedAt).toISOString() : null,
    notebookUrl: null,
    issueUrl: typeof filed === "string" ? filed : typeof existing === "string" ? existing : null,
    cleaned: 0,
    cleanupFailed: 0,
  };
};

/** The Problem → GitHub Issue workflows this app made, by the marker in resolve_problem; newest template first. */
export const findGithubWorkflows = async (): Promise<CreatedWorkflow[]> => {
  const list = await workflowsClient.getWorkflows({ search: GITHUB_WORKFLOW_SEARCH, limit: 50 });
  const found: CreatedWorkflow[] = [];
  for (const workflow of list.results) {
    const full = await workflowsClient.getWorkflow({ id: workflow.id });
    const script = (full.tasks?.[RESOLVE_TASK]?.input as { script?: string } | undefined)?.script ?? "";
    const match = GITHUB_MARKER_PATTERN.exec(script);
    if (!match) continue;
    const version = Number(match[1]);
    const last = full.lastExecution;
    found.push({
      id: full.id,
      title: full.title,
      version,
      outdated: version < GITHUB_TEMPLATE_VERSION,
      isPrivate: full.isPrivate === true,
      deployed: full.isDeployed === true,
      triggerType: full.triggerType,
      settings: summarizeGithubTasks(full.tasks as Record<string, { input?: unknown }> | undefined),
      lastRun: last ? await issueRunOf(last) : null,
    });
  }
  return found.sort((a, b) => b.version - a.version);
};

/**
 * What the workflow uses, for its Authorization settings when they are set to a custom selection:
 * Grail reads for the queries, generative AI for the key actions, email or a notebook for delivery, and
 * the run's own task results for the notebook, and deleting workflows for the cleanup of older versions.
 */
export const INFRA_WORKFLOW_PERMISSIONS = [
  "storage:buckets:read", "storage:metrics:read", "storage:entities:read", "storage:smartscape:read",
  "davis-copilot:conversations:execute", "email:emails:send", "document:documents:write", "automation:workflows:read", "automation:workflows:write",
];

/**
 * Whether each domain has data to report on, from one small query each: a metric seen in the last
 * day, or for network the interface entities the up/down query reads. Without the network device
 * extension both network queries come back empty or fail (diw85600: no interfaces, no interface
 * metrics), so the card says so before a workflow is made. Run with queryExecutionClient, not useDql,
 * so the page's segment filter does not narrow a yes/no question. null: the check itself failed.
 */
const AVAILABILITY_QUERIES: Record<InfraDomain, string> = {
  kubernetes: "timeseries x = avg(dt.kubernetes.container.cpu_usage), from: now()-1d\n| summarize n = count()",
  host: "timeseries x = avg(dt.host.cpu.usage), from: now()-1d\n| summarize n = count()",
  disk: "timeseries x = avg(dt.host.disk.used.percent), from: now()-1d\n| summarize n = count()",
  network: "fetch `dt.entity.network:interface`\n| summarize n = count()",
};

const countOf = async (query: string): Promise<number> => {
  let result = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30_000 } });
  while (result.state === "RUNNING" && result.requestToken) {
    result = await queryExecutionClient.queryPoll({ requestToken: result.requestToken, requestTimeoutMilliseconds: 10_000 });
  }
  return Number((result.result?.records?.[0] as { n?: unknown } | undefined)?.n ?? 0);
};

export type InfraDataAvailability = Record<InfraDomain, boolean | null>;

export const checkInfraData = async (): Promise<InfraDataAvailability> => {
  const entries = await Promise.all(
    INFRA_DOMAINS.map(async (domain) => {
      try {
        return [domain, (await countOf(AVAILABILITY_QUERIES[domain])) > 0] as const;
      } catch {
        return [domain, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as InfraDataAvailability;
};
