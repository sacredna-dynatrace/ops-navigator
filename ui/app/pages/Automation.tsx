import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Chip } from "@dynatrace/strato-components/content";
import { Checkbox, FieldSet, FormField, Label, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { ExternalLinkIcon } from "@dynatrace/strato-icons";
import { workflowLink } from "../analyzeWorkflow";
import { INFRA_WORKFLOW_PERMISSIONS, checkInfraData, createGithubWorkflowLink, createInfraWorkflowLink, executionLink, findGithubWorkflows, findInfraWorkflows, type CreatedWorkflow, type InfraDataAvailability, type LastRun } from "../automationWorkflows";
import {
  DEFAULT_GITHUB_INPUT,
  GITHUB_TEMPLATE_VERSION,
  GITHUB_WORKFLOW_PERMISSIONS,
  GITHUB_WORKFLOW_TITLE,
  OWNER_PATTERN,
  REPOSITORY_PATTERN,
  isLabel,
  parseLabels,
  type GithubLanguage,
} from "../githubIssueWorkflow";
import { useReloadOnReturn } from "../hooks/useReloadOnReturn";
import {
  DEFAULT_INFRA_INPUT,
  INFRA_DOMAINS,
  INFRA_TEMPLATE_VERSION,
  INFRA_WORKFLOW_TITLE,
  isEmailAddress,
  parseRecipients,
  type InfraDelivery,
  type InfraDomain,
  type InfraLanguage,
} from "../infraOptimizationWorkflow";
import { paletteVars } from "../theme/colors";

const DOMAIN_LABELS: Record<InfraDomain, { label: string; hint: string }> = {
  kubernetes: { label: "Kubernetes", hint: "클러스터·워크로드의 CPU/메모리 requests·limits (7일 p95)" },
  host: { label: "호스트", hint: "미사용·과다·과소 프로비저닝 호스트 (30일 p90)" },
  disk: { label: "디스크", hint: "가득 찰 위험이 있거나 줄여도 되는 50GB 이상 디스크 (30일)" },
  network: { label: "네트워크", hint: "포화·up/down 인터페이스 - 네트워크 장비 extension이 있어야 결과가 있습니다" },
};

const TRIGGERS: Record<string, string> = { Manual: "수동", Schedule: "스케줄", Event: "이벤트" };
const RUN_STATES: Record<string, string> = { SUCCESS: "성공", ERROR: "실패", RUNNING: "실행 중", CANCELLED: "취소됨", PAUSED: "일시 중지", UNKNOWN: "알 수 없음" };
const RUN_COLORS: Record<string, "success" | "critical" | "primary" | "neutral"> = { SUCCESS: "success", ERROR: "critical", RUNNING: "primary" };

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

/** Opens in a new tab: the Workflows app or a notebook, while this page stays as it was. */
const NewTabLink = ({ href, children, emphasized }: { href: string; children: React.ReactNode; emphasized?: boolean }) => (
  <Button as="a" href={href} target="_blank" rel="noopener noreferrer" variant={emphasized ? "emphasized" : "default"} color={emphasized ? "primary" : "neutral"}>
    {children}
    <Button.Suffix><ExternalLinkIcon /></Button.Suffix>
  </Button>
);

type Found = { kind: "loading" } | { kind: "ready"; workflows: CreatedWorkflow[] } | { kind: "unknown"; message: string };

/** The workflows this app made from one template; reread when the tab comes back, without blanking what is shown. */
const useCreatedWorkflows = (find: () => Promise<CreatedWorkflow[]>) => {
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) setFound({ kind: "loading" });
    try {
      setFound({ kind: "ready", workflows: await find() });
    } catch (error) {
      setFound({ kind: "unknown", message: error instanceof Error ? error.message : String(error) });
    }
  }, [find]);
  useEffect(() => { void load(false); }, [load]);
  const reloadQuietly = useCallback(() => { void load(true); }, [load]);
  useReloadOnReturn(reloadQuietly);
  return { found, reload: () => void load(false) };
};

const LastRunLine = ({ run }: { run: LastRun | null }) => {
  if (!run) return <span>마지막 실행: 아직 실행하지 않았습니다. Workflows 앱에서 <b>Run</b>으로 시험해 보세요.</span>;
  return (
    <span className="automation-run">
      마지막 실행:
      <Chip size="condensed" color={RUN_COLORS[run.state] ?? "neutral"}>{RUN_STATES[run.state] ?? run.state}</Chip>
      <a href={executionLink(run.id)} target="_blank" rel="noopener noreferrer">{run.startedAt ? formatTime(run.startedAt) : "실행 기록"} <ExternalLinkIcon /></a>
      {run.cleaned > 0 && <span className="automation-note">· 이전 버전 {run.cleaned}개를 휴지통으로 정리했습니다</span>}
      {run.cleanupFailed > 0 && <span className="automation-warning">· 이전 버전 {run.cleanupFailed}개를 정리하지 못했습니다 (workflow 권한에 automation:workflows:write 필요)</span>}
    </span>
  );
};

/** What differs between templates in a created workflow's row. */
type RowNotes = { outdated: (version: number) => React.ReactNode; draft: React.ReactNode };
const INFRA_NOTES: RowNotes = {
  outdated: (version) => <>이전 템플릿(v{version})입니다. v{INFRA_TEMPLATE_VERSION}를 만들어 처음 실행하면 이 workflow는 자동으로 휴지통(Trash)으로 정리됩니다.</>,
  draft: <>Draft 상태입니다. Run으로 실행은 되지만, 스케줄 트리거를 쓰려면 Workflows 앱에서 <b>Deploy</b>하세요.</>,
};
const GITHUB_NOTES: RowNotes = {
  outdated: (version) => <>이전 템플릿(v{version})입니다. v{GITHUB_TEMPLATE_VERSION}를 만든 뒤 이 workflow는 Workflows 앱에서 끄거나 지우세요. 둘 다 켜 두면 한 문제에 이슈가 두 번 만들어질 수 있습니다.</>,
  draft: <>Draft 상태입니다. problem_id를 넣어 Run으로 시험할 수 있지만, 문제가 생길 때 자동으로 동작하려면 Workflows 앱에서 <b>Deploy</b>하세요.</>,
};

/** One created workflow: what it is set to, how it last ran, and links to open it and its result. */
const CreatedRow = ({ workflow, notes }: { workflow: CreatedWorkflow; notes: RowNotes }) => (
  <div className={`automation-created${workflow.outdated ? " automation-created-old" : ""}`}>
    <div className="automation-created-title">
      <strong>{workflow.title}</strong>
      {!workflow.deployed && <Chip size="condensed" color="warning">Draft</Chip>}
      <span className="automation-note">
        {workflow.isPrivate ? "Private" : "Public"} · 트리거: {TRIGGERS[workflow.triggerType] ?? workflow.triggerType} · 템플릿 v{workflow.version}
      </span>
    </div>
    {workflow.outdated && <span className="automation-warning">{notes.outdated(workflow.version)}</span>}
    {!workflow.outdated && !workflow.deployed && <span className="automation-warning">{notes.draft}</span>}
    <span>저장된 설정: {workflow.settings ?? "Workflows 앱에서 Input을 직접 바꿨습니다"}</span>
    <LastRunLine run={workflow.lastRun} />
    <div className="automation-actions">
      <NewTabLink href={workflowLink(workflow.id)} emphasized={!workflow.outdated}>Workflows 앱에서 열기</NewTabLink>
      {workflow.lastRun?.notebookUrl && <NewTabLink href={workflow.lastRun.notebookUrl}>최근 리포트 열기</NewTabLink>}
      {workflow.lastRun?.issueUrl && <NewTabLink href={workflow.lastRun.issueUrl}>최근 이슈 열기</NewTabLink>}
    </div>
  </div>
);

/** The card's status: whether a current-template workflow exists here, and whether it is deployed. */
const StatusChip = ({ found }: { found: Found }) => {
  if (found.kind === "loading") return <Chip color="neutral">확인 중</Chip>;
  if (found.kind === "unknown") return <Chip color="neutral">상태 알 수 없음</Chip>;
  const { workflows } = found;
  const current = workflows.filter((workflow) => !workflow.outdated);
  if (current.length === 0) return workflows.length > 0 ? <Chip color="warning">이전 템플릿</Chip> : <Chip color="neutral">미생성</Chip>;
  const deployed = current.some((workflow) => workflow.deployed);
  return <Chip color={deployed ? "success" : "warning"}>생성됨{deployed ? "" : " · Draft"}{workflows.length > 1 ? ` (${workflows.length})` : ""}</Chip>;
};

/** Infrastructure Optimization Agent: whether it exists, then scope, delivery and language to create one. */
const InfraOptimizationCard = () => {
  const { found, reload } = useCreatedWorkflows(findInfraWorkflows);
  const [scope, setScope] = useState(DEFAULT_INFRA_INPUT.scope);
  // Which domains have data here. Domains without any are unticked once it arrives - unless the
  // user already changed the selection, which then stands.
  const [available, setAvailable] = useState<InfraDataAvailability | null>(null);
  const scopeTouched = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void checkInfraData().then((result) => {
      if (cancelled) return;
      setAvailable(result);
      if (!scopeTouched.current) setScope((value) => Object.fromEntries(INFRA_DOMAINS.map((domain) => [domain, value[domain] && result[domain] !== false])) as typeof value);
    });
    return () => { cancelled = true; };
  }, []);
  // Two independent choices, stored as one workflow input: "email", "notebook" or "both".
  const [byEmail, setByEmail] = useState(DEFAULT_INFRA_INPUT.delivery !== "notebook");
  const [byNotebook, setByNotebook] = useState(DEFAULT_INFRA_INPUT.delivery !== "email");
  const delivery: InfraDelivery | null = byEmail && byNotebook ? "both" : byEmail ? "email" : byNotebook ? "notebook" : null;
  const [language, setLanguage] = useState<InfraLanguage>(DEFAULT_INFRA_INPUT.language);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");

  const workflows = found.kind === "ready" ? found.workflows : [];
  const current = workflows.filter((workflow) => !workflow.outdated);
  const hasCurrent = current.length > 0;

  const recipients = useMemo(() => ({ to: parseRecipients(to), cc: parseRecipients(cc), bcc: parseRecipients(bcc) }), [to, cc, bcc]);
  const invalid = [...recipients.to, ...recipients.cc, ...recipients.bcc].filter((address) => !isEmailAddress(address));
  const problems = [
    !INFRA_DOMAINS.some((domain) => scope[domain]) && "분석 범위를 하나 이상 고르세요.",
    delivery === null && "결과 전달 방식을 하나 이상 고르세요.",
    byEmail && recipients.to.length === 0 && "받는 사람(To)을 한 명 이상 입력하세요.",
    byEmail && invalid.length > 0 && `이메일 주소 형식이 아닙니다: ${invalid.join(", ")}`,
  ].filter((problem): problem is string => typeof problem === "string");

  // The whole definition goes into the link, so it is rebuilt only when an option changes.
  const createLink = useMemo(
    () => createInfraWorkflowLink({ scope, delivery: delivery ?? "email", language, emails: byEmail ? recipients : { to: [], cc: [], bcc: [] } }),
    [scope, delivery, byEmail, language, recipients],
  );

  const chip = <StatusChip found={found} />;

  const form = (
    <>
      <div className="automation-form">
        {/* A FieldSet, not a FormField: a FormField gives the one id it holds to every control inside,
            so all four labels pointed at the first checkbox - clicking Network toggled Kubernetes. */}
        <FieldSet>
          <FieldSet.Legend>분석 범위</FieldSet.Legend>
          <div className="automation-scope">
            {INFRA_DOMAINS.map((domain) => (
              <div key={domain}>
                <Checkbox id={`automation-scope-${domain}`} name={`scope-${domain}`} value={scope[domain]} onChange={(checked: boolean) => { scopeTouched.current = true; setScope((value) => ({ ...value, [domain]: checked })); }}>
                  {DOMAIN_LABELS[domain].label}
                </Checkbox>
                <span className="automation-note">{DOMAIN_LABELS[domain].hint}</span>
                {available?.[domain] === false && (
                  <span className="automation-warning">이 환경에는 데이터가 없습니다. 선택하면 이 영역은 리포트에 &quot;수집하지 못함&quot;으로 나옵니다.</span>
                )}
              </div>
            ))}
          </div>
        </FieldSet>

        <FieldSet>
          <FieldSet.Legend>결과 전달 (하나 이상)</FieldSet.Legend>
          <div className="automation-scope">
            <div>
              <Checkbox id="automation-delivery-email" name="delivery-email" value={byEmail} onChange={(checked: boolean) => setByEmail(checked)}>이메일</Checkbox>
              <span className="automation-note">모든 리포트를 하나로 묶은 메일 한 통. 제목에 분석 범위가 들어갑니다.</span>
            </div>
            <div>
              <Checkbox id="automation-delivery-notebook" name="delivery-notebook" value={byNotebook} onChange={(checked: boolean) => setByNotebook(checked)}>노트북 생성</Checkbox>
              <span className="automation-note">모든 리포트와 원본 데이터 쿼리를 담은 노트북 하나 (workflow 실행자 이름으로 생성).</span>
            </div>
          </div>
          {byEmail && byNotebook && <p className="automation-note">둘 다 고르면 노트북을 먼저 만들고, 메일 맨 위에 그 노트북 링크를 넣습니다.</p>}
        </FieldSet>

        {byEmail && (
          <div className="automation-emails">
            <FormField>
              <Label>받는 사람 (To)</Label>
              <TextInput value={to} onChange={setTo} placeholder="ops@example.com, sre@example.com" />
            </FormField>
            <FormField>
              <Label>참조 (CC)</Label>
              <TextInput value={cc} onChange={setCc} />
            </FormField>
            <FormField>
              <Label>숨은 참조 (BCC)</Label>
              <TextInput value={bcc} onChange={setBcc} />
            </FormField>
            <p className="automation-note">여러 명은 쉼표로 구분합니다.</p>
          </div>
        )}

        <FormField>
          <Label>리포트 언어</Label>
          <ToggleButtonGroup value={language} onChange={(value: string) => setLanguage(value === "English" ? "English" : "Korean")}>
            <ToggleButtonGroup.Item value="Korean">한국어</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="English">English</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        </FormField>
      </div>

      {problems.length > 0 && <ul className="automation-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}

      <div className="automation-actions">
        {problems.length > 0
          ? <Button variant={hasCurrent ? "default" : "emphasized"} color="primary" disabled>{hasCurrent ? "하나 더 만들기" : "워크플로 만들기"}</Button>
          : <Button as="a" href={createLink} target="_blank" rel="noopener noreferrer" variant={hasCurrent ? "default" : "emphasized"} color="primary">
              {hasCurrent ? "하나 더 만들기" : workflows.length > 0 ? `v${INFRA_TEMPLATE_VERSION}로 다시 만들기` : "워크플로 만들기"}
              <Button.Suffix><ExternalLinkIcon /></Button.Suffix>
            </Button>}
        <span className="automation-note">Workflows 앱이 새 탭에서 열립니다. 저장하고 이 탭으로 돌아오면 상태가 바뀝니다.</span>
      </div>
    </>
  );

  return (
    <article className="automation-card">
      <header className="automation-card-header">
        <div>
          <h2>{INFRA_WORKFLOW_TITLE}</h2>
          <p className="automation-note">
            Grail에서 Kubernetes·호스트·디스크·네트워크 사용률을 조회해 비용을 줄이고 위험을 낮추는 최적화 리포트를 만들고, Dynatrace 생성형 AI가 핵심 조치를 요약합니다.
            리포트는 이메일로 보내거나 노트북 하나로 저장합니다.
          </p>
        </div>
        {/* Kept at its full width: in the flex row the chip shrank to "미...". */}
        <span className="automation-card-status">{chip}</span>
      </header>

      <section className={`automation-banner automation-banner-${hasCurrent ? "ok" : workflows.length > 0 ? "old" : "none"}`}>
        {found.kind === "loading" && <span>이 환경에 만들어져 있는지 확인하는 중…</span>}
        {found.kind === "unknown" && <span>workflow 목록을 읽지 못했습니다 ({found.message}). 만들기는 그대로 쓸 수 있습니다.</span>}
        {found.kind === "ready" && workflows.length === 0 && <span>아직 이 환경에 만들어지지 않았습니다. 아래에서 옵션을 고르고 만드세요.</span>}
        {hasCurrent && <strong className="automation-banner-title">✓ 이 환경에 만들어져 있습니다</strong>}
        {workflows.map((workflow) => <CreatedRow key={workflow.id} workflow={workflow} notes={INFRA_NOTES} />)}
        <div className="automation-banner-footer">
          <Button size="condensed" onClick={reload}>새로 고침</Button>
        </div>
      </section>

      {hasCurrent
        ? <details className="automation-more"><summary>다른 설정으로 하나 더 만들기</summary>{form}</details>
        : form}

      <details className="automation-details">
        <summary>만든 뒤 할 일</summary>
        <ol>
          <li><b>워크플로 만들기</b>를 누르면 Workflows 앱이 새 탭에서 정의가 채워진 상태로 열립니다. 저장하면 만든 사람의 권한으로 실행되는 <b>Private</b> workflow가 됩니다. 공유하려면 Workflows 앱에서 Public으로 바꾸세요.</li>
          <li>저장한 workflow는 <b>Draft</b>입니다. <b>Run</b>으로 한 번 시험해 본 뒤 Trigger를 일간·주간 스케줄로 바꾸고 <b>Deploy</b>하세요. Draft로는 스케줄이 동작하지 않습니다.</li>
          <li>처음 실행할 때 이 앱이 만든 이전 버전 workflow를 휴지통(Trash)으로 옮깁니다. Dynatrace 원본 템플릿과 같은 버전으로 더 만든 workflow는 그대로 둡니다.</li>
          <li>범위·전달 방식·언어·수신자는 workflow의 <b>Input</b>(<code>scope</code>, <code>delivery</code>, <code>language</code>, <code>emails</code>)에 들어 있어 다시 만들지 않고 바꿀 수 있습니다.</li>
          <li>Authorization settings를 맞춤 선택으로 제한했다면 다음 권한을 허용하세요: <code>{INFRA_WORKFLOW_PERMISSIONS.join(", ")}</code>.</li>
        </ol>
      </details>
    </article>
  );
};

/**
 * Problem → GitHub Issue: the repository the issues go to, their labels and the report language. The
 * GitHub connection is picked in the Workflows editor - the app cannot list connections.
 */
const GithubIssueCard = () => {
  const { found, reload } = useCreatedWorkflows(findGithubWorkflows);
  const [owner, setOwner] = useState("");
  const [repository, setRepository] = useState("");
  const [labelText, setLabelText] = useState(DEFAULT_GITHUB_INPUT.labels.join(", "));
  const [language, setLanguage] = useState<GithubLanguage>(DEFAULT_GITHUB_INPUT.language);

  const workflows = found.kind === "ready" ? found.workflows : [];
  const hasCurrent = workflows.some((workflow) => !workflow.outdated);
  const labels = useMemo(() => parseLabels(labelText), [labelText]);
  const problems = [
    !OWNER_PATTERN.test(owner.trim()) && "Owner를 입력하세요 (GitHub 사용자 또는 조직 이름: 영문·숫자·하이픈).",
    !REPOSITORY_PATTERN.test(repository.trim()) && "Repository를 입력하세요 (영문·숫자·. _ -).",
    labels.some((label) => !isLabel(label)) && "라벨은 50자 이하여야 합니다.",
  ].filter((problem): problem is string => typeof problem === "string");
  const createLink = useMemo(
    () => createGithubWorkflowLink({ owner: owner.trim(), repository: repository.trim(), labels, language }),
    [owner, repository, labels, language],
  );

  const form = (
    <>
      <div className="automation-form">
        <div className="automation-emails">
          <FormField>
            <Label>Owner</Label>
            <TextInput value={owner} onChange={setOwner} placeholder="my-org" />
          </FormField>
          <FormField>
            <Label>Repository</Label>
            <TextInput value={repository} onChange={setRepository} placeholder="my-service" />
          </FormField>
          <FormField>
            <Label>라벨</Label>
            <TextInput value={labelText} onChange={setLabelText} />
          </FormField>
          <p className="automation-note">라벨은 쉼표로 구분합니다. <code>dynatrace-problem</code>은 dtctl-ai-bug-demo의 GitHub Action이 조사를 시작하는 라벨입니다. 레포에 없는 라벨은 GitHub가 새로 만듭니다.</p>
        </div>
        <FormField>
          <Label>분석 언어</Label>
          <ToggleButtonGroup value={language} onChange={(value: string) => setLanguage(value === "English" ? "English" : "Korean")}>
            <ToggleButtonGroup.Item value="Korean">한국어</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="English">English</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
        </FormField>
      </div>

      {problems.length > 0 && <ul className="automation-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}

      <div className="automation-actions">
        {problems.length > 0
          ? <Button variant={hasCurrent ? "default" : "emphasized"} color="primary" disabled>{hasCurrent ? "하나 더 만들기" : "워크플로 만들기"}</Button>
          : <Button as="a" href={createLink} target="_blank" rel="noopener noreferrer" variant={hasCurrent ? "default" : "emphasized"} color="primary">
              {hasCurrent ? "하나 더 만들기" : workflows.length > 0 ? `v${GITHUB_TEMPLATE_VERSION}로 다시 만들기` : "워크플로 만들기"}
              <Button.Suffix><ExternalLinkIcon /></Button.Suffix>
            </Button>}
        <span className="automation-note">Workflows 앱이 새 탭에서 열립니다. <b>create_issue</b> 태스크에서 GitHub connection을 고른 뒤 저장하세요.</span>
      </div>
    </>
  );

  return (
    <article className="automation-card">
      <header className="automation-card-header">
        <div>
          <h2>{GITHUB_WORKFLOW_TITLE}</h2>
          <p className="automation-note">
            Davis가 오류(Error) 문제를 열면 SRE agent의 분석과 그 문제의 에러 로그(스택 트레이스)를 담은 GitHub 이슈를 만들고, 문제에 이슈 링크를 남깁니다.
            이슈를 받은 코딩 에이전트(GitHub Action의 Claude, Copilot 등)가 원인을 찾아 PR을 열 수 있습니다. 한 문제에는 이슈를 한 번만 만듭니다.
          </p>
        </div>
        <span className="automation-card-status"><StatusChip found={found} /></span>
      </header>

      <section className={`automation-banner automation-banner-${hasCurrent ? "ok" : workflows.length > 0 ? "old" : "none"}`}>
        {found.kind === "loading" && <span>이 환경에 만들어져 있는지 확인하는 중…</span>}
        {found.kind === "unknown" && <span>workflow 목록을 읽지 못했습니다 ({found.message}). 만들기는 그대로 쓸 수 있습니다.</span>}
        {found.kind === "ready" && workflows.length === 0 && <span>아직 이 환경에 만들어지지 않았습니다. 아래에서 레포지토리를 정하고 만드세요.</span>}
        {hasCurrent && <strong className="automation-banner-title">✓ 이 환경에 만들어져 있습니다</strong>}
        {workflows.map((workflow) => <CreatedRow key={workflow.id} workflow={workflow} notes={GITHUB_NOTES} />)}
        <div className="automation-banner-footer">
          <Button size="condensed" onClick={reload}>새로 고침</Button>
        </div>
      </section>

      {hasCurrent
        ? <details className="automation-more"><summary>다른 레포지토리로 하나 더 만들기</summary>{form}</details>
        : form}

      <details className="automation-details">
        <summary>만들기 전에, 그리고 만든 뒤 할 일</summary>
        <ol>
          <li><b>GitHub connection</b>: Settings → Connections → GitHub에서 레포지토리에 Issues 읽기·쓰기 권한이 있는 토큰으로 만듭니다. Settings → General → External requests에 <code>api.github.com</code>을 허용해야 합니다. Fork한 레포는 Issues가 꺼져 있으니 GitHub의 Settings → General → Features에서 <b>Issues</b>를 켜세요.</li>
          <li><b>대상 좁히기</b>: 트리거는 이 환경의 모든 오류 문제입니다. 저장 전에 Workflows 앱의 트리거에서 <b>Entity tags</b>로 이 레포지토리의 서비스만 고르세요. 그러지 않으면 관계없는 문제마다 이슈가 생깁니다.</li>
          <li>저장한 workflow는 <b>Draft</b>입니다. <b>Run</b>에 <code>problem_id</code>(예: <code>P-2611886</code>)를 넣어 한 번 시험한 뒤 <b>Deploy</b>하세요.</li>
          <li><b>보안</b>: 이슈에는 애플리케이션 로그가 그대로 들어갑니다. 비공개 레포지토리를 쓰고, 이슈를 읽는 코딩 에이전트에는 로그를 지시가 아닌 데이터로 다루게 하세요.</li>
          <li>SRE agent를 쓰므로 AI 사용량이 듭니다. Analyze Problem (auto)도 켜져 있으면 같은 문제를 두 번 분석합니다.</li>
          <li>에러 로그는 Ops Navigator 앱이 이 버전 이상일 때만 붙습니다. 이전 버전이면 이슈에 그렇다고 적힙니다.</li>
          <li>Authorization settings를 맞춤 선택으로 제한했다면 다음 권한을 허용하세요: <code>{GITHUB_WORKFLOW_PERMISSIONS.join(", ")}</code>.</li>
        </ol>
      </details>
    </article>
  );
};

/** Automation: ready-made workflows to create in this environment, one card each. */
export const Automation = () => (
  <main className="dashboard-page" style={paletteVars as React.CSSProperties}>
    <section className="dashboard-heading">
      <div>
        <p className="eyebrow">AUTOMATION</p>
        <h1>Automation (자동화)</h1>
        <p className="dashboard-description">
          운영에 바로 쓸 수 있는 Dynatrace workflow를 이 환경에 만듭니다. 옵션을 고르고 만들기를 누르면 Workflows 앱이 새 탭에서 열리고, 거기서 확인하고 저장합니다.
        </p>
      </div>
    </section>
    <div className="automation-list">
      <InfraOptimizationCard />
      <GithubIssueCard />
    </div>
  </main>
);
