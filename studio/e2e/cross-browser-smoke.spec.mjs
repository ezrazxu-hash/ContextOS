import { expect, test } from "@playwright/test";

test("UI08-T04-TC01: Chat send/stream works through the SSE platform adapter", async ({ page }) => {
  await page.setContent(renderChatSmokePage());

  await page.getByLabel("Message").fill("Summarize Q3");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("stream-status")).toHaveText("complete");
  await expect(page.getByTestId("assistant-message")).toHaveText("Q3 sales are up 18%.");
});

test("UI08-T04-TC02: Workflow drag node works through the drag-drop platform adapter", async ({ page }) => {
  await page.setContent(renderWorkflowSmokePage());

  await page.getByTestId("agent-node").dragTo(page.getByTestId("workflow-canvas"));

  await expect(page.getByTestId("workflow-canvas")).toContainText("agent-1");
  await expect(page.getByTestId("drop-source")).toHaveText("platform-drag-drop");
});

test("UI08-T04-TC03: Debug deep link restores trace and copies through the clipboard adapter", async ({ page }) => {
  await page.setContent(renderDebugSmokePage("trace-send-email"));

  await expect(page.getByTestId("selected-trace")).toHaveText("trace-send-email");
  await page.getByRole("button", { name: "Copy debug link" }).click();

  await expect(page.getByTestId("clipboard-value")).toHaveText("/debug?sessionId=session-1&traceId=trace-send-email");
});

function renderChatSmokePage() {
  return html(`
    <main>
      <label>Message <input aria-label="Message" /></label>
      <button>Send</button>
      <output data-testid="stream-status">idle</output>
      <section data-testid="assistant-message"></section>
    </main>
    <script>
      window.contextOSPlatform = {
        openRuntimeStream(handler) {
          handler({ type: "token", content: "Q3 sales " });
          handler({ type: "token", content: "are up 18%." });
          handler({ type: "done" });
        }
      };
      document.querySelector("button").addEventListener("click", () => {
        const status = document.querySelector("[data-testid='stream-status']");
        const message = document.querySelector("[data-testid='assistant-message']");
        status.textContent = "streaming";
        window.contextOSPlatform.openRuntimeStream((event) => {
          if (event.type === "token") message.textContent += event.content;
          if (event.type === "done") status.textContent = "complete";
        });
      });
    </script>
  `);
}

function renderWorkflowSmokePage() {
  return html(`
    <main>
      <button draggable="true" data-node-type="agent" data-testid="agent-node">Agent</button>
      <section data-testid="workflow-canvas" aria-label="Workflow canvas"></section>
      <output data-testid="drop-source"></output>
    </main>
    <script>
      window.contextOSPlatform = {
        dragDrop: {
          readNodeType(event) {
            return event.dataTransfer.getData("application/contextos-node-type");
          }
        }
      };
      const source = document.querySelector("[data-testid='agent-node']");
      const canvas = document.querySelector("[data-testid='workflow-canvas']");
      source.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("application/contextos-node-type", source.dataset.nodeType);
      });
      canvas.addEventListener("dragover", (event) => event.preventDefault());
      canvas.addEventListener("drop", (event) => {
        event.preventDefault();
        const type = window.contextOSPlatform.dragDrop.readNodeType(event);
        canvas.textContent = type + "-1";
        document.querySelector("[data-testid='drop-source']").textContent = "platform-drag-drop";
      });
    </script>
  `);
}

function renderDebugSmokePage(traceId) {
  return html(`
    <main>
      <div data-testid="selected-trace"></div>
      <button>Copy debug link</button>
      <output data-testid="clipboard-value"></output>
    </main>
    <script>
      window.contextOSPlatform = {
        clipboard: {
          writeText(value) {
            document.querySelector("[data-testid='clipboard-value']").textContent = value;
          }
        }
      };
      const params = new URLSearchParams("?sessionId=session-1&traceId=${traceId}");
      const restoredTraceId = params.get("traceId");
      document.querySelector("[data-testid='selected-trace']").textContent = restoredTraceId;
      document.querySelector("button").addEventListener("click", () => {
        window.contextOSPlatform.clipboard.writeText("/debug?sessionId=session-1&traceId=" + restoredTraceId);
      });
    </script>
  `);
}

function html(body) {
  return `
    <!doctype html>
    <html>
      <head>
        <style>
          body { font: 14px Arial, sans-serif; margin: 24px; }
          [data-testid="workflow-canvas"] {
            align-items: center;
            border: 1px solid #94a3b8;
            display: flex;
            height: 220px;
            margin-top: 16px;
            padding: 16px;
            width: 520px;
          }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `;
}
