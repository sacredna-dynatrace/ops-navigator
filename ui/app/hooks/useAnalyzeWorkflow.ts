import { useCallback, useEffect, useRef, useState } from "react";
import { findWorkflows, readAnnotation, requestAnalysis, type AnnotationState, type FoundWorkflows } from "../analyzeWorkflow";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type WorkflowStatus =
  | { kind: "loading" }
  /** The workflows could not be read - no `automation:workflows:read`, or no permission on them. */
  | { kind: "unknown"; message: string }
  | { kind: "ready"; workflows: FoundWorkflows };

/** Which Analyze Problem workflows exist. Unknown is a normal state: the page works without it. */
export const useAnalyzeWorkflows = () => {
  const [status, setStatus] = useState<WorkflowStatus>({ kind: "loading" });
  const reload = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      setStatus({ kind: "ready", workflows: await findWorkflows() });
    } catch (error) {
      setStatus({ kind: "unknown", message: messageOf(error) });
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { status, reload };
};

export type ProblemAnalysis =
  | { kind: "loading" }
  | { kind: "none" }
  /** Requested from this page; no annotation newer than the request yet. */
  | { kind: "requested"; since: number }
  | { kind: "running"; since: number }
  | { kind: "done"; at: number; text: string }
  | { kind: "failed"; at: number; text: string }
  /** Nothing came back in time - the on-demand workflow is probably missing or off. */
  | { kind: "timeout" }
  | { kind: "error"; message: string };

/** How often a pending analysis is checked, and how long a request waits for the workflow to answer. */
const POLL_MS = 5000;
/** The workflow posts its "분석 시작" annotation seconds after the event; nothing after this means it did not run. */
const START_TIMEOUT_MS = 90_000;
/** An agent run takes two to three minutes; allow for a slow one. */
const DONE_TIMEOUT_MS = 8 * 60_000;

const fromAnnotation = (annotation: AnnotationState): ProblemAnalysis =>
  annotation.kind === "none" ? { kind: "none" }
    : annotation.kind === "started" ? { kind: "running", since: annotation.at }
    : annotation.kind === "failed" ? { kind: "failed", at: annotation.at, text: annotation.text }
    : { kind: "done", at: annotation.at, text: annotation.text };

/**
 * The SRE agent's analysis of one problem, read from its annotation in Grail, and a new run on
 * request (a business event the on-demand workflow picks up). Polls while a run is pending -
 * including one the auto workflow started - and stops when the problem changes.
 */
export const useProblemAgentAnalysis = (eventId: string | null, displayId: string | null) => {
  const [state, setState] = useState<ProblemAnalysis>({ kind: "loading" });
  const current = useRef<string | null>(null);

  /** Reads until the annotation is final. `requestedAt` ignores annotations older than this page's request. */
  const follow = useCallback(async (forProblem: string, requestedAt: number | null) => {
    const startedWaiting = Date.now();
    for (;;) {
      if (current.current !== forProblem) return;
      const annotation = await readAnnotation(forProblem);
      if (current.current !== forProblem) return;
      const fresh = requestedAt === null || (annotation.kind !== "none" && annotation.at >= requestedAt);
      if (fresh && (annotation.kind === "done" || annotation.kind === "failed" || annotation.kind === "none")) {
        setState(fromAnnotation(annotation));
        return;
      }
      const waited = Date.now() - startedWaiting;
      if (!fresh) {
        if (waited > START_TIMEOUT_MS) { setState({ kind: "timeout" }); return; }
        setState({ kind: "requested", since: requestedAt ?? startedWaiting });
      } else {
        if (waited > DONE_TIMEOUT_MS) { setState({ kind: "timeout" }); return; }
        setState(fromAnnotation(annotation));
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }, []);

  useEffect(() => {
    current.current = eventId;
    if (!eventId) { setState({ kind: "none" }); return; }
    setState({ kind: "loading" });
    follow(eventId, null).catch((error: unknown) => { if (current.current === eventId) setState({ kind: "error", message: messageOf(error) }); });
  }, [eventId, follow]);

  const run = useCallback(async () => {
    if (!eventId || !displayId) return;
    const forProblem = eventId;
    // A little slack: the annotation's timestamp is set by the platform, not this browser.
    const requestedAt = Date.now() - 5000;
    setState({ kind: "requested", since: Date.now() });
    try {
      await requestAnalysis(displayId);
      await follow(forProblem, requestedAt);
    } catch (error) {
      if (current.current === forProblem) setState({ kind: "error", message: messageOf(error) });
    }
  }, [eventId, displayId, follow]);

  return { state, run };
};
