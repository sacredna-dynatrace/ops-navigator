import { getEnvironmentUrl } from "@dynatrace-sdk/app-environment";
import { getLanguage, getRegionalFormat } from "@dynatrace-sdk/user-preferences";
import { answerLanguageLine, explainPrompt as buildPrompt, type AnalysisProblem, type LogScope } from "./problemAnalysis";

export type { LogScope } from "./problemAnalysis";

/**
 * "Analyze problem" - the Problems app's "Explain problem", asking for more: Dynatrace Assist declares an `ask-question`
 * intent (manifest of `dynatrace.davis.copilot` on isb54165) that opens as an overlay panel and,
 * with `execute`, runs the prompt straight away. No `contexts` are sent: the accepted context types
 * are not documented, and the prompt names the problem and its entities outright.
 */
export const ASSIST_INTENT = { recommendedAppId: "dynatrace.davis.copilot", recommendedIntentId: "ask-question" } as const;

/**
 * The language Assist is asked to answer in, chosen next to the button.
 *
 * Why the prompt has to say it: the Korean answers came from the user's Assist personalization
 * ("Please provide answer in Korean"), not from their Dynatrace language, which is English - and
 * the first prompt this app sends to a freshly opened Assist panel is answered before that
 * personalization applies, so it came back in English while later ones were Korean. The app cannot
 * read Assist's settings, so the user picks the language here and the prompt states it.
 */
export type AnswerLanguage = "ko" | "en" | "auto";
export const ANSWER_LANGUAGES: { value: AnswerLanguage; label: string }[] = [
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "auto", label: "Auto" },
];
/** Korean by default: the reason the selector exists is that answers did not come back in Korean. */
export const DEFAULT_ANSWER_LANGUAGE: AnswerLanguage = "ko";

/** "ko-KR" to "Korean"; null for English, empty or unreadable codes. */
const nonEnglishName = (code: string | undefined): string | null => {
  if (!code || /^en([-_]|$)/i.test(code)) return null;
  try {
    // The base language only: "Korean", not "Korean (South Korea)".
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code.split(/[-_]/)[0]) ?? null;
  } catch {
    return null;
  }
};
const safely = (read: () => string): string | undefined => {
  try { return read(); } catch { return undefined; }
};

/**
 * The language to put in the prompt, as an English name, or null to say nothing.
 *
 * "auto" looks at the Dynatrace language, then the regional format, then the browser, and takes the
 * first that is not English; English everywhere means no instruction. The explicit choices always
 * state the language - "English" included, so it wins over a Korean Assist personalization.
 */
export const answerLanguage = (choice: AnswerLanguage): string | null => {
  if (choice === "ko") return "Korean";
  if (choice === "en") return "English";
  const candidates = [safely(getLanguage), safely(getRegionalFormat), typeof navigator === "undefined" ? undefined : navigator.language];
  for (const code of candidates) {
    const name = nonEnglishName(code);
    if (name) return name;
  }
  return null;
};

/**
 * The browser's time zone ("Asia/Seoul"), or null when it is UTC or cannot be read.
 *
 * Assist answers in whatever zone the prompt uses, and the prompt states UTC - which Assist and DQL
 * read unambiguously - so a timeline came back in UTC while the rest of the page shows local time.
 * The prompt keeps UTC for the window Assist queries and asks, once, for the answer in this zone -
 * Assist converts the times itself.
 */
export const browserTimeZone = (): string | null => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && !/^(Etc\/)?(UTC|GMT)$/i.test(zone) ? zone : null;
  } catch {
    return null;
  }
};

/**
 * The Assist prompt for one problem, in the browser's time zone. The prompt itself lives in
 * `problemAnalysis.ts`, shared with the `build-analysis-prompt` workflow action.
 */
export const explainPrompt = (problem: AnalysisProblem, language: string | null, scope: LogScope, zone: string | null = browserTimeZone()): string =>
  buildPrompt(problem, language, scope, zone, getEnvironmentUrl());

/**
 * The SRE agent's verdict, short enough for an Assist prompt: the paragraph after the Verdict heading,
 * markdown stripped, IPv4 addresses masked - Assist's PII blocking rejected a whole prompt over an
 * address before (see the notes) - and cut at 600 characters.
 */
export const agentVerdict = (report: string): string => {
  const lines = report.split("\n").map((line) => line.trim());
  const heading = lines.findIndex((line) => /^#+\s*.*(판정|Verdict)/i.test(line) || /^\*\*(판정|Verdict)/i.test(line));
  const after = (heading >= 0 ? lines.slice(heading + 1) : lines).filter((line) => line && !/^(#|---|\|)/.test(line));
  const verdict = (after[0] ?? "").replace(/\*\*/g, "").replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[IP]");
  return verdict.length > 600 ? `${verdict.slice(0, 599)}…` : verdict;
};

/**
 * Follow-up in Assist once the SRE agent has analyzed the problem: the agent's verdict as context and
 * no new analysis - one engine analyzes, Assist is for asking about it. Sent without `execute`, so the
 * user types the question under it.
 */
export const followUpPrompt = (problem: AnalysisProblem, report: string, language: string | null, zone: string | null = browserTimeZone()): string => {
  const start = Date.parse(problem.start);
  const end = Date.parse(problem.end);
  const iso = (time: number) => `${new Date(time).toISOString().slice(0, 16)}Z`;
  const window = Number.isFinite(start) ? `, ${iso(start)} to ${problem.active ? "ongoing" : iso(Number.isFinite(end) ? end : start)}` : "";
  return [
    `Davis problem ${problem.displayId} "${problem.title}"${window}.`,
    `The built-in SRE agent has already analyzed it; its full report is the problem's annotation "Analyze problem (SRE agent)". Its verdict: ${agentVerdict(report)}`,
    "Do not redo the analysis. I will ask follow-up questions about it: for each, query only what that question needs, in the problem's window, and say plainly where the data disagrees with the verdict.",
    zone ? `Give times in ${zone} with the zone label; query results are UTC, so convert them first.` : "",
    answerLanguageLine(language),
    "My question:",
  ].filter(Boolean).join("\n");
};
