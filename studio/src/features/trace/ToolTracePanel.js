export function createToolTracePanel(debugIndex) {
  return {
    runs: (debugIndex.traces?.items ?? []).filter(isToolEvent).map((event) => ({
      id: event.id,
      component: event.component,
      duration: event.duration,
      status: event.status,
    })),
    calls: (debugIndex.traces?.items ?? []).filter(isToolEvent).map((event) => ({
      id: event.id,
      component: event.component,
      duration: event.duration,
      status: event.status,
      replayable: event.replayable ?? event.replay_policy !== "NEVER",
      risk: riskFor(event),
    })),
  };
}

function isToolEvent(event) {
  return event.step_type === "tool_call" || event.step_type === "tool_result";
}

function riskFor(event) {
  if (!event.side_effect) {
    return null;
  }
  return {
    kind: "side_effect",
    label: "Side effect",
    sideEffect: event.side_effect,
    replayPolicy: event.replay_policy ?? null,
  };
}
