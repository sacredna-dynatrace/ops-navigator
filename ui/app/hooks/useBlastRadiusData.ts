import { useMemo } from "react";
import type { Timeframe } from "@dynatrace/strato-components/core";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { resolveTimeframe, type ResolvedTimeframe } from "./useTopologyData";
import { tagArrayCondition } from "../components/SharedFilters";
import { DISPLAY_ID, PROBLEM_SUMMARIZE, problemFromRecord, strings, text, type AnalysisProblem } from "../problemAnalysis";

export type { ProblemOrigin } from "../problemAnalysis";

type DqlRecord = Record<string, unknown>;

export type BlastQueryKey = "problems" | "services" | "frontends" | "workloads" | "frontendIds";

/** One Davis problem, collapsed from its state-change records. Defined with the Analyze-problem prompt, which reads it too. */
export type BlastProblem = AnalysisProblem;

export type ServiceInfo = { id: string; name: string; type: string; calledBy: string[]; hosts: string[]; pgis: string[] };
export type FrontendCall = { appId: string; appName: string; serviceId: string };

const QUERY_LIMITS = { maxResultRecords: 25000, maxResultBytes: 50_000_000 } as const;
/** A result sitting on its cap was cut off - the same silent-truncation rule as the topology map. */
const PROBLEM_LIMIT = 500;
const SERVICE_LIMIT = 25000;
const FRONTEND_LIMIT = 5000;
const WORKLOAD_LIMIT = 25000;
const FRONTEND_ID_LIMIT = 25000;
export const BLAST_CAPS: Record<BlastQueryKey, number> = { problems: PROBLEM_LIMIT, services: SERVICE_LIMIT, frontends: FRONTEND_LIMIT, workloads: WORKLOAD_LIMIT, frontendIds: FRONTEND_ID_LIMIT };

const timeWindow = (timeframe: ResolvedTimeframe) => `from: "${timeframe.from}", to: "${timeframe.to}"`;

/**
 * One record per problem (`PROBLEM_SUMMARIZE`, shared with the Analyze-problem workflow action), with
 * duplicates dropped - the same rule the Problems tile uses. Ordered so the problems worth looking at come first: open ones, then the ones
 * that reached the most users and entities.
 */
const problemsQuery = (timeframe: ResolvedTimeframe, tags: string[]) => `fetch dt.davis.problems, ${timeWindow(timeframe)}
| filter dt.davis.is_duplicate == false
${PROBLEM_SUMMARIZE}
${tags.length > 0 ? `| filter ${tagArrayCondition("entity_tags", tags)}\n` : ""}// Nulls sort first in a descending sort, which put problems without a user estimate on top.
| fieldsAdd users_rank = coalesce(users, 0)
| sort active desc, users_rank desc, n_affected desc, start desc
| limit ${PROBLEM_LIMIT}`;

/**
 * Who calls whom, from the classic entity model.
 *
 * Smartscape has no SERVICE-to-SERVICE \`calls\` edge (see the notes), so \`called_by\` is the only
 * call graph there is. It covers OneAgent services only - an OTLP-only service has no callers here
 * and the rings stop at it. The platform caps very long relationship lists (it warns, it does not
 * fail), so a service with hundreds of callers shows a subset.
 */
const servicesQuery = (timeframe: ResolvedTimeframe) => `fetch dt.entity.service, ${timeWindow(timeframe)}
| fields id, name = entity.name, service_type = serviceType, called_by = called_by[dt.entity.service], hosts = runs_on[dt.entity.host], pgis = runs_on[dt.entity.process_group_instance]
| limit ${SERVICE_LIMIT}`;

/**
 * Classic workload ids to Smartscape ones, for links into the Kubernetes app. Problems name a
 * workload `CLOUD_APPLICATION-…`; the app opens `K8S_DEPLOYMENT-…` (or another kind), and the hex
 * parts differ, so only `id_classic` connects them.
 */
const workloadsQuery = (timeframe: ResolvedTimeframe) => `smartscapeNodes K8S_DEPLOYMENT, K8S_STATEFULSET, K8S_DAEMONSET, K8S_CRONJOB, K8S_JOB, ${timeWindow(timeframe)}
| filter isNotNull(id_classic)
| fields id = toString(id), classic = toString(id_classic)
| limit ${WORKLOAD_LIMIT}`;

/**
 * Classic RUM application ids to Smartscape FRONTEND ids, for links into the frontend app. Problems
 * name a web application `APPLICATION-…`; the frontend app opens `FRONTEND-…`, and the hex parts
 * differ (APPLICATION-34EA… is FRONTEND-89A1… on bby34718), so only `id_classic` connects them.
 */
const frontendIdsQuery = (timeframe: ResolvedTimeframe) => `smartscapeNodes FRONTEND, ${timeWindow(timeframe)}
| filter isNotNull(id_classic)
| fields id = toString(id), classic = toString(id_classic)
| limit ${FRONTEND_ID_LIMIT}`;

/** RUM applications calling services: the outermost ring, where the end users are. */
const frontendsQuery = (timeframe: ResolvedTimeframe) => `smartscapeEdges calls, ${timeWindow(timeframe)}
| filter source_type == "FRONTEND" and target_type == "SERVICE"
| fields app = toString(source_id), svc = toString(target_id)
| lookup [
    smartscapeNodes FRONTEND, ${timeWindow(timeframe)}
    | fields app = toString(id), app_name = name
  ], sourceField: app, lookupField: app, fields: { app_name }
| limit ${FRONTEND_LIMIT}`;

const records = (data: { records?: unknown[] } | undefined): DqlRecord[] =>
  data && Array.isArray(data.records) ? data.records.filter((record): record is DqlRecord => Boolean(record && typeof record === "object")) : [];
/**
 * The shared tag filter matches a problem's `entity_tags` - the tags of every entity Davis attached,
 * hosts included, in the same strings as service tags (bby34718: "To-Be" on 99 of 132 problems in
 * seven days). Segments narrow the problem list only: the call graph and entity lookups draw the
 * rings around whatever problem is picked, and a segment would cut dependencies out of them.
 */
export const useBlastRadiusData = (timeframe: Timeframe, refreshedAt: number, tags: string[]) => {
  const resolved = useMemo(() => resolveTimeframe(timeframe, refreshedAt), [timeframe, refreshedAt]);
  const queries = useMemo<Record<BlastQueryKey, string>>(() => ({
    problems: problemsQuery(resolved, tags),
    services: servicesQuery(resolved),
    frontends: frontendsQuery(resolved),
    workloads: workloadsQuery(resolved),
    frontendIds: frontendIdsQuery(resolved),
  }), [resolved, tags]);
  const problems = useDql({ query: queries.problems, ...QUERY_LIMITS });
  const services = useDql({ query: queries.services, ...QUERY_LIMITS, filterSegments: [] });
  const frontends = useDql({ query: queries.frontends, ...QUERY_LIMITS, filterSegments: [] });
  const workloads = useDql({ query: queries.workloads, ...QUERY_LIMITS, filterSegments: [] });
  const frontendIds = useDql({ query: queries.frontendIds, ...QUERY_LIMITS, filterSegments: [] });

  const problemList = useMemo<BlastProblem[]>(() => records(problems.data).flatMap((record) => {
    const problem = problemFromRecord(record);
    return problem ? [problem] : [];
  }), [problems.data]);

  const serviceMap = useMemo(() => new Map<string, ServiceInfo>(records(services.data).flatMap((record) => {
    const id = text(record, "id");
    return id ? [[id, { id, name: text(record, "name") || id, type: text(record, "service_type"), calledBy: strings(record, "called_by"), hosts: strings(record, "hosts"), pgis: strings(record, "pgis") }] as const] : [];
  })), [services.data]);

  const frontendCalls = useMemo<FrontendCall[]>(() => records(frontends.data).flatMap((record) => {
    const appId = text(record, "app");
    const serviceId = text(record, "svc");
    return appId && serviceId ? [{ appId, appName: text(record, "app_name") || appId, serviceId }] : [];
  }), [frontends.data]);

  /** Classic `CLOUD_APPLICATION-…` to Smartscape workload id. */
  const workloadIds = useMemo(() => new Map<string, string>(records(workloads.data).flatMap((record) => {
    const classic = text(record, "classic");
    const id = text(record, "id");
    return classic && id ? [[classic, id] as const] : [];
  })), [workloads.data]);

  /** Classic `APPLICATION-…` to Smartscape `FRONTEND-…`. */
  const frontendIdOf = useMemo(() => new Map<string, string>(records(frontendIds.data).flatMap((record) => {
    const classic = text(record, "classic");
    const id = text(record, "id");
    return classic && id ? [[classic, id] as const] : [];
  })), [frontendIds.data]);

  const counts: Record<BlastQueryKey, number> = { problems: records(problems.data).length, services: records(services.data).length, frontends: records(frontends.data).length, workloads: records(workloads.data).length, frontendIds: records(frontendIds.data).length };
  return {
    queries,
    resolved,
    problems: problemList,
    services: serviceMap,
    frontendCalls,
    workloadIds,
    frontendIdOf,
    isLoading: problems.isLoading || services.isLoading || frontends.isLoading,
    // Per query, as on the topology page: one failure does not blank the others.
    errors: ([["Problems", problems.error], ["Service call graph", services.error], ["RUM-to-service", frontends.error], ["Workload ids", workloads.error], ["Frontend ids", frontendIds.error]] as const)
      .flatMap(([label, error]) => (error ? [{ label, message: error.message }] : [])),
    truncated: (Object.keys(counts) as BlastQueryKey[]).filter((key) => counts[key] > 0 && counts[key] >= BLAST_CAPS[key]),
    refetch: async () => { await Promise.all([problems.refetch(), services.refetch(), frontends.refetch(), workloads.refetch(), frontendIds.refetch()]); },
  };
};

/**
 * Davis's own write-up of one problem - root cause, baselines, what else changed - fetched only when
 * a problem is selected. Kept out of the list query: at a few hundred problems the descriptions
 * would dominate the payload for text nobody reads until they open one.
 */
export const useProblemDescription = (displayId: string | null, timeframe: ResolvedTimeframe) => {
  const valid = displayId !== null && DISPLAY_ID.test(displayId);
  const query = valid ? `fetch dt.davis.problems, ${timeWindow(timeframe)}
| filter display_id == "${displayId}" and dt.davis.is_duplicate == false
| sort timestamp desc
| limit 1
| fields description = event.description, impact = dt.davis.impact_level` : "data record(description = \"\")";
  // A problem already picked from the (segmented) list: its description is not filtered again.
  const result = useDql({ query, ...QUERY_LIMITS, filterSegments: [] }, { enabled: valid });
  const record = records(result.data)[0];
  return {
    description: valid && record ? text(record, "description") : "",
    impact: valid && record ? strings(record, "impact") : [],
    isLoading: valid && result.isLoading,
    error: valid ? result.error?.message ?? null : null,
  };
};
