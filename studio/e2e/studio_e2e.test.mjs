import { test } from "node:test";
import assert from "node:assert/strict";

import { createStudioRouter } from "../src/features/navigation/router.js";
import { createRuntimeProjectionStore } from "../src/features/runtimeProjection/store.js";

test("Studio E2E smoke loads a route and rehydrates through the API client boundary", async () => {
  const router = createStudioRouter();
  const page = router.resolve("/chat");
  const runtimeProjection = createRuntimeProjectionStore({
    async fetchRehydrateSnapshot(sessionId) {
      return {
        sessionId,
        timelineId: "timeline-e2e",
        checkpointId: "checkpoint-e2e",
        contextRevision: "context-e2e",
      };
    },
  });

  const snapshot = await runtimeProjection.rehydrate("session-e2e");

  assert.equal(page.name, "Chat");
  assert.equal(snapshot.timelineId, "timeline-e2e");
});
