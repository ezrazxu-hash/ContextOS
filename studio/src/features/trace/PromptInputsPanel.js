export function createPromptInputsPanel(debugIndex) {
  const inputs = (debugIndex.prompt_inputs ?? []).map((input) => ({
    messageId: input.message_id,
    content: input.content,
  }));
  return {
    inputs,
    tabs: {
      structured: {
        inputs: (debugIndex.prompt_inputs ?? []).map((input) => ({
          messageId: input.message_id,
          content: input.content,
          tokenCount: input.token_count ?? estimateTokens(input.content),
        })),
      },
      raw: { copyable: true },
    },
    copyRaw(messageId) {
      return inputs.find((input) => input.messageId === messageId)?.content ?? null;
    },
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

function estimateTokens(content = "") {
  return String(content).trim() ? Math.ceil(String(content).trim().split(/\s+/).length * 1.3) : 0;
}
