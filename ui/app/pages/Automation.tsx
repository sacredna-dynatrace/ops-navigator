import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Checkbox, FormField, Label, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { ExternalLinkIcon } from "@dynatrace/strato-icons";
import { workflowLink } from "../analyzeWorkflow";
import { INFRA_WORKFLOW_PERMISSIONS, findInfraWorkflows, openCreateInfraWorkflow, type CreatedWorkflow } from "../automationWorkflows";
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

type Found = { kind: "loading" } | { kind: "ready"; workflows: CreatedWorkflow[] } | { kind: "unknown"; message: string };

const useInfraWorkflows = () => {
  const [found, setFound] = useState<Found>({ kind: "loading" });
  const reload = useCallback(async () => {
    setFound({ kind: "loading" });
    try {
      setFound({ kind: "ready", workflows: await findInfraWorkflows() });
    } catch (error) {
      setFound({ kind: "unknown", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { found, reload };
};

/** Infrastructure Optimization Agent: scope, delivery and language, then the Workflows app. */
const InfraOptimizationCard = () => {
  const { found, reload } = useInfraWorkflows();
  const [scope, setScope] = useState(DEFAULT_INFRA_INPUT.scope);
  const [delivery, setDelivery] = useState<InfraDelivery>(DEFAULT_INFRA_INPUT.delivery);
  const [language, setLanguage] = useState<InfraLanguage>(DEFAULT_INFRA_INPUT.language);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");

  const recipients = { to: parseRecipients(to), cc: parseRecipients(cc), bcc: parseRecipients(bcc) };
  const invalid = [...recipients.to, ...recipients.cc, ...recipients.bcc].filter((address) => !isEmailAddress(address));
  const problems = [
    !INFRA_DOMAINS.some((domain) => scope[domain]) && "분석 범위를 하나 이상 고르세요.",
    delivery === "email" && recipients.to.length === 0 && "받는 사람(To)을 한 명 이상 입력하세요.",
    delivery === "email" && invalid.length > 0 && `이메일 주소 형식이 아닙니다: ${invalid.join(", ")}`,
  ].filter((problem): problem is string => typeof problem === "string");

  const create = () =>
    openCreateInfraWorkflow({ scope, delivery, language, emails: delivery === "email" ? recipients : { to: [], cc: [], bcc: [] } });

  const workflows = found.kind === "ready" ? found.workflows : [];

  return (
    <article className="automation-card">
      <header className="automation-card-header">
        <div>
          <h2>{INFRA_WORKFLOW_TITLE}</h2>
          <p className="automation-note">
            Grail에서 Kubernetes·호스트·디스크·네트워크 사용률을 조회하고, Dynatrace 생성형 AI가 비용을 줄이고 위험을 낮추는 최적화 리포트를 씁니다.
            리포트는 이메일로 보내거나 노트북 하나로 저장합니다.
          </p>
        </div>
        <span className="automation-tag">템플릿 v{INFRA_TEMPLATE_VERSION}</span>
      </header>

      <div className="automation-form">
        <FormField>
          <Label>분석 범위</Label>
          <div className="automation-scope">
            {INFRA_DOMAINS.map((domain) => (
              <div key={domain}>
                <Checkbox name={`scope-${domain}`} value={scope[domain]} onChange={(checked: boolean) => setScope((current) => ({ ...current, [domain]: checked }))}>
                  {DOMAIN_LABELS[domain].label}
                </Checkbox>
                <span className="automation-note">{DOMAIN_LABELS[domain].hint}</span>
              </div>
            ))}
          </div>
        </FormField>

        <FormField>
          <Label>결과 전달</Label>
          <ToggleButtonGroup value={delivery} onChange={(value: string) => setDelivery(value === "notebook" ? "notebook" : "email")}>
            <ToggleButtonGroup.Item value="email">이메일</ToggleButtonGroup.Item>
            <ToggleButtonGroup.Item value="notebook">노트북 생성</ToggleButtonGroup.Item>
          </ToggleButtonGroup>
          <p className="automation-note">
            {delivery === "email"
              ? "영역마다 리포트 메일을 한 통씩 보냅니다 (Kubernetes 메일에는 원본 데이터 포함)."
              : "실행할 때마다 모든 리포트와 원본 데이터 쿼리를 담은 노트북 하나를 workflow 실행자 이름으로 만듭니다."}
          </p>
        </FormField>

        {delivery === "email" && (
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
        <Button variant="emphasized" color="primary" disabled={problems.length > 0} onClick={() => { void create(); }}>
          워크플로 만들기
        </Button>
        <Button onClick={() => { void reload(); }}>새로 고침</Button>
      </div>

      <div className="automation-status">
        {found.kind === "loading" && <span className="automation-note">만든 workflow를 확인하는 중…</span>}
        {found.kind === "unknown" && <span className="automation-note">workflow 목록을 읽지 못했습니다 ({found.message}). 만들기는 그대로 쓸 수 있습니다.</span>}
        {found.kind === "ready" && workflows.length === 0 && <span className="automation-note">아직 이 앱에서 만든 workflow가 없습니다.</span>}
        {workflows.map((workflow) => (
          <a key={workflow.id} href={workflowLink(workflow.id)} target="_blank" rel="noopener noreferrer">
            {workflow.title} · v{workflow.version}{workflow.outdated ? " (이전 템플릿)" : ""} · {workflow.isPrivate ? "Private" : "Public"} <ExternalLinkIcon />
          </a>
        ))}
      </div>

      <details className="automation-details">
        <summary>만든 뒤 할 일</summary>
        <ol>
          <li><b>워크플로 만들기</b>를 누르면 Workflows 앱이 정의가 채워진 상태로 열립니다. 저장하면 만든 사람의 권한으로 실행되는 <b>Private</b> workflow가 됩니다. 공유하려면 Workflows 앱에서 Public으로 바꾸세요.</li>
          <li>트리거는 수동입니다. <b>Run</b>으로 한 번 시험해 본 뒤 Trigger를 일간·주간 스케줄로 바꾸세요.</li>
          <li>범위·전달 방식·언어·수신자는 workflow의 <b>Input</b>(<code>scope</code>, <code>delivery</code>, <code>language</code>, <code>emails</code>)에 들어 있어 다시 만들지 않고 바꿀 수 있습니다.</li>
          <li>Authorization settings를 맞춤 선택으로 제한했다면 다음 권한을 허용하세요: <code>{INFRA_WORKFLOW_PERMISSIONS.join(", ")}</code>.</li>
        </ol>
      </details>
    </article>
  );
};

/**
 * Automation: ready-made workflows to create in this environment. One so far - each new one is another
 * card.
 */
export const Automation = () => (
  <main className="dashboard-page" style={paletteVars as React.CSSProperties}>
    <section className="dashboard-heading">
      <div>
        <p className="eyebrow">AUTOMATION</p>
        <h1>Automation (자동화)</h1>
        <p className="dashboard-description">
          운영에 바로 쓸 수 있는 Dynatrace workflow를 이 환경에 만듭니다. 옵션을 고르고 만들기를 누르면 Workflows 앱에서 확인하고 저장합니다.
        </p>
      </div>
    </section>
    <div className="automation-list">
      <InfraOptimizationCard />
    </div>
  </main>
);
