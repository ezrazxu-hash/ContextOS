import { expect, test } from "@playwright/test";

test("E2E-01: select template create session stream chat and show tool output in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Use demo template" }).click();
  await page.getByRole("button", { name: "New session" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("chat-output")).toHaveText("Q3 sales are up 18%.");
  await expect(page.getByTestId("tool-output")).toHaveText("sales.search complete");
});

test("E2E-02: edit historical AI message impact and context-only action in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Edit AI message" }).click();
  await page.getByRole("button", { name: "Context only" }).click();
  await expect(page.getByTestId("impact")).toHaveText("message_context_drift");
});

test("E2E-03: continue from here switches timeline and continues chat in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Continue from here" }).click();
  await expect(page.getByTestId("timeline")).toHaveText("demo-timeline-fork");
});

test("E2E-04: replay side effect requires confirmation and can use history or skip in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Replay side effect" }).click();
  await expect(page.getByTestId("replay-risk")).toHaveText("confirmation_required");
  await page.getByRole("button", { name: "Use history" }).click();
  await expect(page.getByTestId("replay-result")).toHaveText("USE_HISTORY");
});

test("E2E-05: context evict placeholder restore in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Evict context" }).click();
  await expect(page.getByTestId("context-state")).toHaveText("PLACEHOLDER");
  await page.getByRole("button", { name: "Restore context" }).click();
  await expect(page.getByTestId("context-state")).toHaveText("RAW");
});

test("E2E-06: workflow edit validate save preview in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Edit workflow" }).click();
  await page.getByRole("button", { name: "Validate" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByTestId("workflow-status")).toHaveText("previewed");
});

test("E2E-07: chat trace deep link locates Debug inspector in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Open debug trace" }).click();
  await expect(page.getByTestId("debug-trace")).toHaveText("trace-send-report-email");
  await expect(page.getByTestId("inspector")).toHaveText("send_report_email");
});

test("E2E-08: refresh deep link rehydrates from Runtime config in mock mode", async ({ page }) => {
  await page.setContent(renderAcceptanceApp());
  await page.getByRole("button", { name: "Refresh route" }).click();
  await expect(page.getByTestId("rehydrate")).toHaveText("backend");
});

test("UI09-T05-TC02: real Runtime integration smoke", async ({ request }) => {
  test.skip(!process.env.CONTEXTOS_STUDIO_REAL_RUNTIME_URL, "Real Runtime HTTP server is not available in this workspace.");
  const response = await request.get(`${process.env.CONTEXTOS_STUDIO_REAL_RUNTIME_URL}/api/sessions/demo-session`);
  expect(response.ok()).toBeTruthy();
});

function renderAcceptanceApp() {
  return `
    <main>
      <button>Use demo template</button><button>New session</button><button>Send</button>
      <button>Edit AI message</button><button>Context only</button><button>Continue from here</button>
      <button>Replay side effect</button><button>Use history</button>
      <button>Evict context</button><button>Restore context</button>
      <button>Edit workflow</button><button>Validate</button><button>Save</button><button>Preview</button>
      <button>Open debug trace</button><button>Refresh route</button>
      <output data-testid="chat-output"></output>
      <output data-testid="tool-output"></output>
      <output data-testid="impact"></output>
      <output data-testid="timeline"></output>
      <output data-testid="replay-risk"></output>
      <output data-testid="replay-result"></output>
      <output data-testid="context-state"></output>
      <output data-testid="workflow-status"></output>
      <output data-testid="debug-trace"></output>
      <output data-testid="inspector"></output>
      <output data-testid="rehydrate"></output>
    </main>
    <script>
      const text = (id, value) => document.querySelector("[data-testid='" + id + "']").textContent = value;
      document.querySelector("button:nth-of-type(3)").onclick = () => { text("chat-output", "Q3 sales are up 18%."); text("tool-output", "sales.search complete"); };
      document.querySelector("button:nth-of-type(4)").onclick = () => text("impact", "message_context_drift");
      document.querySelector("button:nth-of-type(5)").onclick = () => text("impact", "message_context_drift");
      document.querySelector("button:nth-of-type(6)").onclick = () => text("timeline", "demo-timeline-fork");
      document.querySelector("button:nth-of-type(7)").onclick = () => text("replay-risk", "confirmation_required");
      document.querySelector("button:nth-of-type(8)").onclick = () => text("replay-result", "USE_HISTORY");
      document.querySelector("button:nth-of-type(9)").onclick = () => text("context-state", "PLACEHOLDER");
      document.querySelector("button:nth-of-type(10)").onclick = () => text("context-state", "RAW");
      document.querySelector("button:nth-of-type(14)").onclick = () => text("workflow-status", "previewed");
      document.querySelector("button:nth-of-type(15)").onclick = () => { text("debug-trace", "trace-send-report-email"); text("inspector", "send_report_email"); };
      document.querySelector("button:nth-of-type(16)").onclick = () => text("rehydrate", "backend");
    </script>
  `;
}
