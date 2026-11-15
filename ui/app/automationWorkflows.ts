import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { executionsClient, workflowsClient } from "@dynatrace-sdk/client-automation";
import { getIntentLink } from "@dynatrace-sdk/navigation";
import {
  INFRA_MARKER_PATTERN,
  INFRA_TEMPLATE_VERSION,
  INFRA_WORKFLOW_TITLE,
  NOTEBOOK_TASK,
  infraOptimizationWorkflow,
  summarizeInfraInput,
  type InfraOptimizationInput,
} from "./infraOptimizationWorkflow";

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

const base = () => getEnvironmentUrl().replace(/\/$/, "");
/** A run in the Workflows app. */
export const executionLink = (id: string) => `${base()}/ui/apps/dynatrace.automations/executions/${encodeURIComponent(id)}`;

export type LastRun = { id: string; state: string; startedAt: string | null; notebookUrl: string | null };

export type CreatedWorkflow = {
  id: string;
  title: string;
  version: number;
  outdated: boolean;
  isPrivate: boolean;
  /** "Manual", "Schedule", "Event" - as the API names it. */
  triggerType: string;
  /** The saved input in one line, or null when it no longer has this template's shape. */
  settings: string | null;
  lastRun: LastRun | null;
};

/** The notebook a run saved, if it ran in notebook mode; skipped or failed task -> null. */
const notebookOf = async (executionId: string): Promise<string | null> => {
  try {
    const task = await executionsClient.getTaskExecution({ executionId, id: NOTEBOOK_TASK });
    const url = (task.result as { url?: unknown } | undefined)?.url;
    return typeof url === "string" ? url : null;
  } catch {
    return null;
  }
};

/**
 * The Infrastructure Optimization workflows this app made that the user can see, newest template
 * first. Recognized by the marker in the notebook task, so Dynatrace's own template - same title -
 * is not counted. Needs `automation:workflows:read`; the caller treats a refusal as "unknown".
 */
export const findInfraWorkflows = async (): Promise<CreatedWorkflow[]> => {
  const list = await workflowsClient.getWorkflows({ search: "Infrastructure Optimization", limit: 50 });
  const found: CreatedWorkflow[] = [];
  for (const workflow of list.results) {
    if (!workflow.title.includes(INFRA_WORKFLOW_TITLE)) continue;
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
      triggerType: full.triggerType,
      settings: summarizeInfraInput(full.input),
      lastRun: last
        ? { id: last.id, state: last.state, startedAt: last.startedAt ? new Date(last.startedAt).toISOString() : null, notebookUrl: last.state === "SUCCESS" ? await notebookOf(last.id) : null }
        : null,
    });
  }
  return found.sort((a, b) => b.version - a.version);
};

/**
 * What the workflow uses, for its Authorization settings when they are set to a custom selection:
 * Grail reads for the queries, generative AI for the reports, email or a notebook for delivery, and
 * the run's own task results for the notebook.
 */
export const INFRA_WORKFLOW_PERMISSIONS = [
  "storage:buckets:read", "storage:metrics:read", "storage:entities:read", "storage:smartscape:read",
  "davis-copilot:conversations:execute", "email:emails:send", "document:documents:write", "automation:workflows:read",
];
