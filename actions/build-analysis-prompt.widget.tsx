import { AutomationTextInput } from "@dynatrace/automation-action-components";
import { FormField, Label } from "@dynatrace/strato-components/forms";
import type { ActionWidget } from "@dynatrace-sdk/automation-action-utils";
import React from "react";

interface BuildAnalysisPromptInput {
  problemId: string;
  language: string;
  timeZone: string;
}

/** Inputs of the build-analysis-prompt action, as the workflow editor shows them. */
const BuildAnalysisPromptWidget: ActionWidget<BuildAnalysisPromptInput> = (props) => {
  const { value, onValueChanged } = props;
  const update = (next: Partial<BuildAnalysisPromptInput>) => onValueChanged({ ...value, ...next });

  return (
    <>
      <FormField>
        <Label>Problem ID (display id, e.g. {'{{ event()["display_id"] }}'})</Label>
        <AutomationTextInput value={value.problemId} onChange={(problemId) => update({ problemId })} />
      </FormField>
      <FormField>
        <Label>Answer language (English name, empty for none; default Korean)</Label>
        <AutomationTextInput value={value.language} onChange={(language) => update({ language })} />
      </FormField>
      <FormField>
        <Label>Time zone for the answer (IANA, default Asia/Seoul)</Label>
        <AutomationTextInput value={value.timeZone} onChange={(timeZone) => update({ timeZone })} />
      </FormField>
    </>
  );
};

export default BuildAnalysisPromptWidget;
