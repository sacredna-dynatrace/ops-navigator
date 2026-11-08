import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { ExternalLinkIcon } from "@dynatrace/strato-icons";
import { TEMPLATE_VERSION, WORKFLOW_TITLES, openCreateWorkflow, workflowLink, type WorkflowInfo, type WorkflowKind } from "../analyzeWorkflow";
import type { WorkflowStatus } from "../hooks/useAnalyzeWorkflow";

type Props = { show: boolean; onClose: () => void; status: WorkflowStatus; onReload: () => void };

const PURPOSE: Record<WorkflowKind, string> = {
  auto: "열린 지 10분 지난 ERROR/SLOWDOWN 문제를 자동으로 분석합니다. 생성 시 꺼져 있습니다.",
  onDemand: "이 페이지의 SRE agent로 분석 버튼이 실행합니다. 생성 시 켜져 있습니다.",
};

/** One workflow: what it does, whether it exists, and how to create or open it. */
const Row = ({ kind, info, known }: { kind: WorkflowKind; info: WorkflowInfo | undefined; known: boolean }) => (
  <div className="auto-analysis-row">
    <strong>{WORKFLOW_TITLES[kind]}</strong>
    <span className="auto-analysis-note">{PURPOSE[kind]}</span>
    {known && <span>
      {!info ? "없음" : `${info.active ? "켜짐" : "꺼짐"} · 템플릿 v${info.version}${info.outdated ? ` (v${TEMPLATE_VERSION} 있음)` : ""}${info.actor ? ` · 실행 주체 ${info.actor}` : ""}`}
    </span>}
    <div className="auto-analysis-actions">
      {(!info || info.outdated) && <Button variant={info ? "default" : "emphasized"} color="primary" onClick={() => openCreateWorkflow(kind, info?.id)}>
        {info ? `v${TEMPLATE_VERSION}로 업데이트` : "만들기"}
      </Button>}
      {info && <a href={workflowLink(info.id)} target="_blank" rel="noopener noreferrer">Workflows 앱에서 열기 (켜기·끄기) <ExternalLinkIcon /></a>}
    </div>
  </div>
);

/**
 * Settings for the two Analyze Problem workflows. The app cannot write workflows (custom apps may not
 * hold that scope), so "만들기" opens the Workflows app with the definition filled in and the user
 * saves it; switching and deleting happen there too.
 */
export const AutoAnalysisSheet = ({ show, onClose, status, onReload }: Props) => {
  const known = status.kind === "ready";
  const workflows = status.kind === "ready" ? status.workflows : { others: [] };
  return (
    <Sheet title="자동 분석 설정 (SRE agent)" show={show} onDismiss={onClose} actions={<><Button onClick={onReload}>새로 고침</Button><Button onClick={onClose}>닫기</Button></>}>
      <div className="auto-analysis">
        <Paragraph>
          Blast radius의 <b>Analyze problem</b> 프롬프트를 Dynatrace 내장 SRE agent가 분석하고, 결과를 문제 주석으로 남기는 workflow입니다.
          workflow 하나에는 트리거를 하나만 둘 수 있어서 두 개로 나뉩니다. 태스크는 같습니다.
        </Paragraph>
        <Paragraph className="auto-analysis-note">
          <b>만들기</b>를 누르면 Workflows 앱이 정의가 채워진 상태로 열립니다. 저장하면 만든 사람의 권한으로 실행됩니다.
          저장한 뒤 이 패널에서 <b>새로 고침</b>을 누르세요. 막 저장한 workflow는 1분쯤 지나야 트리거가 동작합니다.
        </Paragraph>
        {status.kind === "loading" && <Paragraph>workflow를 확인하는 중…</Paragraph>}
        {status.kind === "unknown" && <div className="query-message" role="status">
          workflow 목록을 읽지 못해 상태를 표시할 수 없습니다 ({status.message}). 만들기와 분석 버튼은 그대로 쓸 수 있습니다.
        </div>}
        <Row kind="onDemand" info={workflows.onDemand} known={known} />
        <Row kind="auto" info={workflows.auto} known={known} />
        {workflows.others.length > 0 && <div className="auto-analysis-row">
          <strong>이전 버전 / 사본 {workflows.others.length}개</strong>
          <span className="auto-analysis-note">앱은 workflow를 지울 권한이 없습니다. 열어서 삭제하세요 (켜져 있으면 문제마다 분석이 중복 실행됩니다).</span>
          {workflows.others.map((other) => <a key={other.id} className="auto-analysis-link" href={workflowLink(other.id)} target="_blank" rel="noopener noreferrer">
            {other.title} · v{other.version} · {other.active ? "켜짐" : "꺼짐"} <ExternalLinkIcon />
          </a>)}
        </div>}
        <Paragraph className="auto-analysis-note">
          내장 <b>SRE Agent</b> workflow와 auto workflow를 함께 켜면 문제마다 분석이 두 번 실행됩니다. 하나만 켜 두세요.
          <b>업데이트</b>는 같은 workflow를 새 정의로 덮어쓰도록 열립니다. Workflows 앱에서 트리거를 확인하고 저장하세요. 그래도 사본이 생기면 위 목록에서 지우세요.
        </Paragraph>
      </div>
    </Sheet>
  );
};
