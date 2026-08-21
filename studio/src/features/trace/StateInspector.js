export function createStateInspector(checkpoint) {
  if (!checkpoint) {
    return { checkpointId: null, graphState: null };
  }
  return {
    checkpointId: checkpoint.id,
    graphState: clone(checkpoint.graph_state ?? checkpoint.graphState ?? {}),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
