import { workflowsClient } from "@dynatrace-sdk/client-automation";
import { sendIntent } from "@dynatrace-sdk/navigation";
import {
  INFRA_MARKER_PATTERN,
  INFRA_TEMPLATE_VERSION,
  INFRA_WORKFLOW_TITLE,
  NOTEBOOK_TASK,
  infraOptimizationWorkflow,
  type InfraOptimizationInput,
} from "./infraOptimizationWorkflow";

/**
 * The Automation page's workflows. Like the Analyze Problem ones (analyzeWorkflow.ts) the app cannot
 * write workflows, so it opens the Workflows app's create-workflow intent with the definition filled
 * in and the user saves it. The intent takes `input` and `isPrivate` but no description or guide.
 */
export const openCreateInfraWorkflow = (input: InfraOptimizationInput) =>
  sendIntent(infraOptimizationWorkflow(input) as never, { recommendedAppId: "dynatrace.automations", recommendedIntentId: "create-workflow" });

export type CreatedWorkflow = { id: string; title: string; version: number; outdated: boolean; isPrivate: boolean };

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
    found.push({ id: full.id, title: full.title, version, outdated: version < INFRA_TEMPLATE_VERSION, isPrivate: full.isPrivate === true });
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
