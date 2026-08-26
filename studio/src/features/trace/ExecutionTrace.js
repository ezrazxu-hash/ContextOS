export function createExecutionTrace(debugIndex) {
  const items = (debugIndex.traces?.items ?? []).map(toTraceRow);
  const indexes = buildIndexes(items);
  return {
    items,
    performance: performanceMeta(items, "indexed", items.length),
    filter(criteria = {}) {
      return filterItems(items, indexes, criteria);
    },
    sortBy(field, direction = "asc") {
      return createTraceTable(sortItems(items, field, direction), performanceMeta(items, "indexed", items.length));
    },
    async openDetail(eventId, rawLoader) {
      const item = items.find((traceItem) => traceItem.id === eventId);
      const raw = await rawLoader(eventId);
      return { ...item, rawLoaded: true, raw };
    },
    copyFailedTraceId(eventId) {
      const item = items.find((traceItem) => traceItem.id === eventId && traceItem.status === "failed");
      return item?.traceId ?? null;
    },
    loadRaw(eventId, rawLoader) {
      return rawLoader(eventId);
    },
  };
}

function createTraceTable(items) {
  return createTraceTableWithPerformance(items, performanceMeta(items, "derived", items.length));
}

function createTraceTableWithPerformance(items, performance) {
  return {
    items,
    performance,
    filter(criteria = {}) {
      return createTraceTable(items.filter((item) => matchesCriteria(item, criteria)));
    },
    sortBy(field, direction = "asc") {
      return createTraceTableWithPerformance(sortItems(items, field, direction), performance);
    },
  };
}

function filterItems(items, indexes, criteria) {
  const candidates = indexedCandidates(items, indexes, criteria);
  return createTraceTableWithPerformance(candidates.filter((item) => matchesCriteria(item, criteria)), performanceMeta(items, "indexed", candidates.length));
}

function toTraceRow(event) {
  const status = event.status;
  const row = {
    id: event.id,
    traceId: event.trace_id,
    stepType: event.step_type,
    component: event.component,
    inputSummary: event.input_summary,
    outputSummary: event.output_summary,
    duration: event.duration,
    status,
    rawLoaded: false,
  };
  Object.defineProperties(row, {
    type: { value: displayType(event.step_type), enumerable: false },
    actions: { value: { copyTraceId: status === "failed" }, enumerable: false },
  });
  return row;
}

function matchesCriteria(item, criteria) {
  const types = criteria.types ?? [];
  if (types.length > 0 && !types.includes(item.type)) {
    return false;
  }
  if (criteria.component && item.component !== criteria.component) {
    return false;
  }
  if (criteria.status && item.status !== criteria.status) {
    return false;
  }
  return true;
}

function buildIndexes(items) {
  return {
    status: indexBy(items, "status"),
    component: indexBy(items, "component"),
    type: indexBy(items, "type"),
  };
}

function indexedCandidates(items, indexes, criteria) {
  const candidateSets = [];
  if (criteria.status) {
    candidateSets.push(indexes.status.get(criteria.status) ?? []);
  }
  if (criteria.component) {
    candidateSets.push(indexes.component.get(criteria.component) ?? []);
  }
  const types = criteria.types ?? [];
  if (types.length > 0) {
    candidateSets.push(types.flatMap((type) => indexes.type.get(type) ?? []));
  }
  if (candidateSets.length === 0) {
    return items;
  }
  return candidateSets.reduce((smallest, next) => (next.length < smallest.length ? next : smallest));
}

function indexBy(items, field) {
  const index = new Map();
  for (const item of items) {
    const value = item[field];
    const bucket = index.get(value) ?? [];
    bucket.push(item);
    index.set(value, bucket);
  }
  return index;
}

function performanceMeta(items, strategy, scanned) {
  return {
    strategy,
    total: items.length,
    scanned,
  };
}

function sortItems(items, field, direction) {
  const sign = direction === "desc" ? -1 : 1;
  return [...items].sort((left, right) => compareValues(left[field], right[field]) * sign);
}

function compareValues(left, right) {
  if (left === right) {
    return 0;
  }
  if (left === undefined || left === null) {
    return 1;
  }
  if (right === undefined || right === null) {
    return -1;
  }
  return left > right ? 1 : -1;
}

function displayType(stepType) {
  const value = stepType ?? "";
  if (value.startsWith("model")) {
    return "Model";
  }
  if (value.startsWith("tool")) {
    return "Tool";
  }
  if (value.startsWith("state")) {
    return "State";
  }
  if (value.startsWith("context")) {
    return "Context";
  }
  if (value.startsWith("checkpoint")) {
    return "Checkpoint";
  }
  if (value.startsWith("replay")) {
    return "Replay";
  }
  return value;
}
