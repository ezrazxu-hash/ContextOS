export function createStateInspector(checkpoint) {
  if (!checkpoint) {
    return { checkpointId: null, graphState: null, fields: [], rawJson: "{}" };
  }
  const graphState = clone(checkpoint.graph_state ?? checkpoint.graphState ?? {});
  return {
    checkpointId: checkpoint.id,
    graphState,
    fields: toFields(graphState),
    rawJson: JSON.stringify(graphState, null, 2),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toFields(graphState) {
  return Object.entries(graphState)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => ({ path, value }));
}
