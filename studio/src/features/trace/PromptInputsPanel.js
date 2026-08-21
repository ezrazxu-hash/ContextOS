export function createPromptInputsPanel(debugIndex) {
  return {
    inputs: (debugIndex.prompt_inputs ?? []).map((input) => ({
      messageId: input.message_id,
      content: input.content,
    })),
    compilerDiagnostics: (debugIndex.traces?.items ?? []).filter(isCompilerFailure).map((event) => ({
      id: event.id,
      fieldPath: event.field_path ?? "",
      message: event.output_summary,
      status: event.status,
    })),
  };
}

function isCompilerFailure(event) {
  return event.step_type === "compiler_validation_failure";
}
