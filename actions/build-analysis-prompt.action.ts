import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { userLogger } from "@dynatrace-sdk/automation-action-utils/actions";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { DISPLAY_ID, errorLogsQuery, explainPrompt, logScopeOf, problemFactsQuery, problemFromRecord, scopeServiceIds, serviceHostsQuery, strings, text } from "../ui/app/problemAnalysis";

/**
 * Builds the Blast radius page's "Analyze problem" prompt for one Davis problem, for an AI task in a
 * workflow. The prompt comes from `ui/app/problemAnalysis.ts`, the same code the page sends to
 * Dynatrace Assist, so a workflow run and a click on the page ask the same question.
 */
interface ActionInput {
  /** Davis display id, e.g. `P-2611156` - in an event-triggered workflow, `event()["display_id"]`. */
  problemId?: string;
  /** English name of the answer language ("Korean"); empty for no instruction. */
  language?: string;
  /** IANA zone the answer's times are given in ("Asia/Seoul"); empty for UTC. */
  timeZone?: string;
}

type DqlRecord = Record<string, unknown>;

const DEFAULT_LANGUAGE = "Korean";
const DEFAULT_TIME_ZONE = "Asia/Seoul";

/** Runs one DQL query to completion. The client returns RUNNING with a token for slow queries. */
const runQuery = async (query: string): Promise<DqlRecord[]> => {
  let response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30_000, maxResultRecords: 1000 },
  });
  let polls = 0;
  while (response.state === "RUNNING" && response.requestToken && polls < 15) {
    polls += 1;
    response = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 10_000 });
  }
  if (response.state !== "SUCCEEDED") throw new Error(`Query did not finish (state ${response.state}): ${query.split("\n")[0]}`);
  const records: unknown[] = response.result?.records ?? [];
  return records.filter((record): record is DqlRecord => Boolean(record && typeof record === "object"));
};

/** A zone the runtime knows, or null - an unknown zone would make the prompt ask for times nobody can give. */
const validZone = (zone: string): string | null => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
};

/**
 * Why problemFactsQuery found nothing. It skips Davis duplicates, and a duplicate is easy to pick by hand
 * (P-2611889 was a duplicate of P-2611886 and the run said "not found"), so name the problem it merged
 * into: the non-duplicate one that started within the hour around it and shares an affected entity.
 */
const notFoundReason = async (problemId: string): Promise<string> => {
  const [duplicate] = await runQuery(`fetch dt.davis.problems, from: now() - 7d
| filter display_id == "${problemId}" and dt.davis.is_duplicate == true
| sort timestamp desc
| limit 1
| fields event.start, affected_entity_ids`);
  if (!duplicate) return `Problem ${problemId} was not found in dt.davis.problems over the last 7 days.`;
  const ids = strings(duplicate, "affected_entity_ids").filter((id) => /^[A-Z_]+-[0-9A-F]+$/.test(id));
  const start = text(duplicate, "event.start");
  const originals = ids.length > 0 && start
    ? await runQuery(`fetch dt.davis.problems, from: now() - 8d
| filter dt.davis.is_duplicate == false and display_id != "${problemId}"
| filter abs(event.start - toTimestamp("${start}")) <= 1h
| expand affected_entity_ids
| filter in(affected_entity_ids, array(${ids.map((id) => `"${id}"`).join(", ")}))
| summarize n = count(), by: { display_id }
| sort display_id
| limit 5`).catch(() => [])
    : [];
  const names = originals.map((row) => text(row, "display_id")).filter(Boolean);
  return `Problem ${problemId} is a Davis duplicate - Davis merged it into another problem, and duplicates are not analyzed. `
    + (names.length > 0 ? `Run with ${names.join(" or ")} instead.` : "Run with the problem it was merged into.");
};

export default async (payload: ActionInput) => {
  const problemId = (payload.problemId ?? "").trim();
  if (!DISPLAY_ID.test(problemId)) throw new Error(`Input 'problemId' must be a Davis display id like P-2611156, got '${problemId}'.`);
  // An empty string means "say nothing"; only a missing value falls back to the default.
  const language = payload.language === undefined ? DEFAULT_LANGUAGE : payload.language.trim() || null;
  const zoneInput = payload.timeZone === undefined ? DEFAULT_TIME_ZONE : payload.timeZone.trim();
  const zone = zoneInput && !/^(Etc\/)?(UTC|GMT)$/i.test(zoneInput) ? validZone(zoneInput) : null;
  if (zoneInput && !zone && !/^(Etc\/)?(UTC|GMT)$/i.test(zoneInput)) userLogger.warn(`Unknown time zone '${zoneInput}'; the prompt keeps UTC.`);

  const [record] = await runQuery(problemFactsQuery(problemId));
  const problem = record ? problemFromRecord(record) : null;
  if (!problem) throw new Error(await notFoundReason(problemId));

  // The hosts the problem's services run on: the only log scope a problem tied purely to services has.
  const hostsQuery = serviceHostsQuery(scopeServiceIds(problem));
  const hostRecords = hostsQuery ? await runQuery(hostsQuery) : [];
  const hostsByService = new Map(hostRecords.map((row) => [text(row, "id"), strings(row, "hosts")] as const));
  const scope = logScopeOf(problem, (id) => hostsByService.get(id));

  // Absolute links for the answer; without the URL the prompt asks for plain ids instead.
  let environmentUrl: string | null = null;
  try { environmentUrl = getEnvironmentUrl(); } catch { userLogger.warn("Environment URL unavailable; the prompt asks for plain ids instead of links."); }
  const prompt = explainPrompt(problem, language, scope, zone, environmentUrl);
  userLogger.info(`Built the analysis prompt for ${problem.displayId} (${problem.origin}, ${prompt.length} characters).`);
  return {
    prompt,
    // For the workflow's clean_report task, which links entity ids in the answer.
    environmentUrl,
    displayId: problem.displayId,
    eventId: problem.eventId,
    title: problem.title,
    category: problem.category,
    active: problem.active,
    origin: problem.origin,
    rootId: problem.rootId,
    affectedCount: problem.affected.length,
    // For the GitHub issue workflow, which runs it and puts the stack traces in the issue. Not run here:
    // the Analyze Problem workflows do not need it.
    errorLogsQuery: errorLogsQuery(problem, scope),
    promptLength: prompt.length,
  };
};
