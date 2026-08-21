export const CONTEXT_OPERATIONS = ["pin", "unpin", "abstract", "evict", "restore", "view_raw"];

export function createContextPanel(apiClient, { sessionId, maxTokens }) {
  let items = [];
  let lastError = null;

  async function refresh() {
    items = await apiClient.fetchSessionContext(sessionId);
    lastError = null;
    return view();
  }

  async function runGroupOperation(groupId, operation, payload = {}) {
    const response = await operation(groupId, payload);
    if (response?.ok === false) {
      lastError = response.error ?? "operation_failed";
      return view();
    }
    return refresh();
  }

  function view() {
    return {
      sections: groupByState(items),
      tokenUsage: tokenUsage(items, maxTokens),
      operations: CONTEXT_OPERATIONS,
      lastError,
    };
  }

  return {
    get operations() {
      return CONTEXT_OPERATIONS;
    },
    refresh,
    pin(groupId) {
      return runGroupOperation(groupId, apiClient.pinGroup.bind(apiClient));
    },
    unpin(groupId) {
      return runGroupOperation(groupId, apiClient.unpinGroup.bind(apiClient));
    },
    abstract(groupId, payload) {
      return runGroupOperation(groupId, apiClient.abstractGroup.bind(apiClient), payload);
    },
    evict(groupId) {
      return runGroupOperation(groupId, apiClient.evictGroup.bind(apiClient));
    },
    restore(groupId) {
      return runGroupOperation(groupId, apiClient.restoreGroup.bind(apiClient));
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
