export const CONTEXT_OPERATIONS = ["pin", "unpin", "abstract", "evict", "restore", "view_raw"];

const PRODUCT_SECTION_META = {
  PINNED: { stateLabel: "Pinned", icon: "pin" },
  RAW: { stateLabel: "Raw", icon: "file-text" },
  ABSTRACT: { stateLabel: "Abstract", icon: "sparkles" },
  EVICTED: { stateLabel: "Evicted", icon: "archive" },
  REFERENCE: { stateLabel: "Reference", icon: "link" },
};

export function createContextPanel(apiClient, { sessionId, maxTokens, renderLimit = 50 }) {
  let items = [];
  let lastError = null;
  let selectedDetail = null;
  let selectedItemId = null;
  let reallocationSummary = null;
  const groupOperations = new Map();

  async function refresh() {
    items = await apiClient.fetchSessionContext(sessionId);
    lastError = null;
    return view();
  }

  async function runGroupOperation(groupId, operationName, operation, payload = {}) {
    if (groupOperations.get(groupId)?.status === "pending") {
      return view();
    }

    groupOperations.set(groupId, pendingGroupOperation(groupId, operationName));
    const response = await operation(groupId, payload);
    if (response?.ok === false) {
      lastError = response.error ?? "operation_failed";
      groupOperations.set(groupId, {
        groupId,
        status: "failed",
        operation: operationName,
        message: lastError,
        disabledOperations: [],
      });
      return view();
    }
    reallocationSummary = normalizeReallocation(response?.reallocation);
    groupOperations.set(groupId, {
      groupId,
      status: "succeeded",
      operation: operationName,
      message: null,
      disabledOperations: [],
    });
    return refresh();
  }

  function view() {
    const sections = groupByState(items);
    return {
      sections,
      tokenUsage: tokenUsage(items, maxTokens),
      tokenMeter: tokenMeter(items, maxTokens),
      productSections: productSections(sections, renderLimit),
      operations: CONTEXT_OPERATIONS,
      lastError,
      groupOperations: Object.fromEntries(groupOperations.entries()),
      selection: { itemId: selectedItemId },
      reallocationSummary,
    };
  }

  return {
    get operations() {
      return CONTEXT_OPERATIONS;
    },
    refresh,
    view,
    selectItem(itemId) {
      itemById(items, itemId);
      selectedItemId = itemId;
      return view();
    },
    pin(groupId) {
      return runGroupOperation(groupId, "pin", apiClient.pinGroup.bind(apiClient));
    },
    unpin(groupId) {
      return runGroupOperation(groupId, "unpin", apiClient.unpinGroup.bind(apiClient));
    },
    abstract(groupId, payload) {
      return runGroupOperation(groupId, "abstract", apiClient.abstractGroup.bind(apiClient), payload);
    },
    evict(groupId) {
      return runGroupOperation(groupId, "evict", apiClient.evictGroup.bind(apiClient));
    },
    restore(groupId) {
      return runGroupOperation(groupId, "restore", apiClient.restoreGroup.bind(apiClient));
    },
    async openDetail(itemId) {
      selectedDetail = await createDetailView(itemById(items, itemId), apiClient);
      return selectedDetail;
    },
    async loadRaw(itemId) {
      const raw = await apiClient.fetchRaw(itemId);
      selectedDetail = detailWithRaw(selectedDetail ?? createBaseDetail(itemById(items, itemId)), raw);
      return selectedDetail;
    },
    async restoreSystemVersion(itemId) {
      await apiClient.restoreSystemVersion(itemId);
      await refresh();
      selectedDetail = await createDetailView(itemById(items, itemId), apiClient);
      return selectedDetail;
    },
    async viewRaw(itemId) {
      const raw = await apiClient.fetchRaw(itemId);
      return {
        id: raw.id,
        rawContent: raw.raw_content,
      };
    },
  };
}

function groupByState(items) {
  const sections = {
    PINNED: [],
    RAW: [],
    ABSTRACT: [],
    EVICTED: [],
    REFERENCE: [],
  };
  for (const item of items) {
    if (!sections[item.state]) {
      sections[item.state] = [];
    }
    sections[item.state].push(item);
  }
  return sections;
}

function tokenUsage(items, maxTokens) {
  const current = items.reduce((total, item) => total + (item.token_count_effective ?? 0), 0);
  return {
    current,
    max: maxTokens,
    remaining: maxTokens - current,
  };
}

function tokenMeter(items, maxTokens) {
  const usage = tokenUsage(items, maxTokens);
  return {
    ...usage,
    percent: usage.max > 0 ? Math.round((usage.current / usage.max) * 100) : 0,
  };
}

function productSections(sections, renderLimit) {
  return Object.fromEntries(
    Object.entries(PRODUCT_SECTION_META).map(([state, meta]) => {
      const items = sections[state] ?? [];
      const totalTokens = items.reduce((total, item) => total + (item.token_count_effective ?? 0), 0);
      return [
        state,
        {
          state,
          ...meta,
          totalCount: items.length,
          totalTokens,
          groups: groupSummaries(items),
          renderedItems: items.slice(0, renderLimit).map(contextListItem),
          ariaLabel: `${meta.stateLabel} context, ${items.length} ${items.length === 1 ? "item" : "items"}, ${totalTokens} tokens`,
        },
      ];
    }),
  );
}

function groupSummaries(items) {
  const summaries = new Map();
  for (const item of items) {
    const groupId = item.group_id ?? "ungrouped";
    const summary = summaries.get(groupId) ?? {
      groupId,
      totalCount: 0,
      totalTokens: 0,
    };
    summary.totalCount += 1;
    summary.totalTokens += item.token_count_effective ?? 0;
    summaries.set(groupId, summary);
  }
  return Array.from(summaries.values());
}

function contextListItem(item) {
  const { raw_content: _rawContent, ...listItem } = item;
  return listItem;
}

async function createDetailView(item, apiClient) {
  const detail = createBaseDetail(item);
  if (apiClient.fetchRevisions) {
    detail.tabs.revisions.items = await apiClient.fetchRevisions(item.id);
  }
  return detail;
}

function createBaseDetail(item) {
  return {
    item,
    summary: {
      id: item.id,
      groupId: item.group_id,
      state: item.state,
      rawContentLoaded: false,
    },
    userModified: Boolean(item.user_override),
    tabs: {
      effective: {
        content: item.effective_content ?? "",
        generatedContent: item.generated_content ?? null,
        userOverride: item.user_override ?? null,
      },
      raw: {
        loaded: false,
        content: null,
      },
      revisions: {
        items: [],
      },
      sources: {
        source: item.source ?? { ids: item.source_ids ?? [], type: "internal", trust: "trusted" },
      },
    },
  };
}

function detailWithRaw(detail, raw) {
  return {
    ...detail,
    summary: {
      ...detail.summary,
      rawContentLoaded: true,
    },
    tabs: {
      ...detail.tabs,
      raw: {
        loaded: true,
        content: raw.raw_content,
      },
    },
  };
}

function itemById(items, itemId) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error(`Context item not found: ${itemId}`);
  }
  return item;
}

function pendingGroupOperation(groupId, operation) {
  return {
    groupId,
    status: "pending",
    operation,
    message: null,
    disabledOperations: ["pin", "unpin", "abstract", "evict", "restore"],
  };
}

function normalizeReallocation(reallocation) {
  if (!reallocation) {
    return null;
  }
  return {
    status: reallocation.status,
    evictedGroupIds: reallocation.evicted_group_ids ?? reallocation.evictedGroupIds ?? [],
    finalTokens: reallocation.final_tokens ?? reallocation.finalTokens ?? null,
  };
}
