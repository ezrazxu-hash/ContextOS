import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI01-T04 a single feature crash does not remove App navigation", async () => {
  const { createAppErrorBoundary } = await import(moduleUrl("src/app/appFeedback.js"));

  const boundary = createAppErrorBoundary({
    navigation: [{ label: "Chat", path: "/chat" }, { label: "Debug", path: "/debug" }],
  });

  const view = boundary.render(() => {
    throw new Error("feature failed");
  });

  assert.equal(view.kind, "error");
  assert.equal(view.shellVisible, true);
  assert.deepEqual(view.navigation.map((item) => item.path), ["/chat", "/debug"]);
});

test("UI01-T04 danger confirm cannot be triggered by Enter as the default action", async () => {
  const { createConfirmService } = await import(moduleUrl("src/app/appFeedback.js"));

  const confirmService = createConfirmService();
  const dialog = confirmService.danger({
    title: "Replay side-effect tool",
    confirmLabel: "Reinvoke tool",
  });

  const enterResult = dialog.handleKey("Enter");
  const explicitResult = dialog.confirm();

  assert.equal(dialog.defaultAction, null);
  assert.equal(enterResult.confirmed, false);
  assert.equal(explicitResult.confirmed, true);
});

test("UI01-T04 network recovery exposes a manual retry action", async () => {
  const { createRetryController } = await import(moduleUrl("src/app/appFeedback.js"));

  const calls = [];
  const retry = createRetryController({
    retry() {
      calls.push("retry");
      return { status: "ok" };
    },
  });

  const recovered = retry.networkRecovered();
  const result = retry.manualRetry();

  assert.deepEqual(recovered.action, { id: "retry", label: "Retry" });
  assert.deepEqual(result, { status: "ok" });
  assert.deepEqual(calls, ["retry"]);
});
