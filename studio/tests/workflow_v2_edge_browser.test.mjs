import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

test("Workflow V2 deleting edges updates in place without resetting scroll or remounting the workbench", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-edge-panel']");

    const before = await page.evaluate(() => {
      const surface = document.querySelector("[data-testid='workflow-v2-workbench']");
      const canvas = document.querySelector("[data-testid='workflow-v2-canvas']");
      canvas.style.height = "360px";
      canvas.style.maxHeight = "360px";
      surface.dataset.probeRoot = "before-delete";
      canvas.dataset.probeCanvas = "before-delete";
      canvas.scrollTop = canvas.scrollHeight;
      return {
        scrollTop: canvas.scrollTop,
        edgeCount: document.querySelectorAll(".workflow-v2-edge-row").length,
        rootProbe: surface.dataset.probeRoot,
        canvasProbe: canvas.dataset.probeCanvas,
      };
    });

    assert.ok(before.scrollTop > 0);

    await page.locator("[data-action='delete-workflow-v2-edge']").last().click();
    const afterOne = await workbenchState(page);

    await page.locator("[data-action='delete-workflow-v2-edge']").last().click();
    const afterTwo = await workbenchState(page);

    assert.equal(afterOne.edgeCount, before.edgeCount - 1);
    assert.equal(afterTwo.edgeCount, before.edgeCount - 2);
    assert.ok(afterOne.scrollTop > 0);
    assert.ok(afterTwo.scrollTop > 0);
    assert.equal(afterOne.rootProbe, "before-delete");
    assert.equal(afterTwo.rootProbe, "before-delete");
    assert.equal(afterOne.canvasProbe, "before-delete");
    assert.equal(afterTwo.canvasProbe, "before-delete");
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 success handle click does not create edges and manual connect renders arrows", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-edge-panel']");
    const initialEdges = await edgeRowCount(page);

    await page.locator("[data-action='add-workflow-v2-node'][data-node-type='agent']").click();
    await page.locator("[data-source-id='agent-1'][data-source-handle='']").click();

    assert.equal(await edgeRowCount(page), initialEdges);
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-source']").inputValue(), "agent-1");

    await page.locator("[data-testid='workflow-v2-edge-target']").selectOption("end-1");
    await page.locator("[data-action='connect-workflow-v2-edge']").click();

    assert.equal(await edgeRowCount(page), initialEdges + 1);
    assert.ok(await page.locator("[data-testid='workflow-v2-edge-layer'] marker#workflow-v2-arrowhead").count() > 0);
    assert.ok(await page.locator("[data-testid='workflow-v2-edge-layer'] path[marker-end='url(#workflow-v2-arrowhead)']").count() > 0);

    await page.locator("[data-testid='workflow-v2-edge-target']").selectOption("end-1");
    await page.locator("[data-action='connect-workflow-v2-edge']").click();

    assert.equal(await edgeRowCount(page), initialEdges + 1);

    await page.locator("[data-testid='workflow-v2-save']").click();
    await page.reload();
    await page.waitForSelector("[data-testid='workflow-v2-edge-panel']");

    assert.ok(await page.locator("[data-testid='workflow-v2-edge-layer'] marker#workflow-v2-arrowhead").count() > 0);
    assert.ok(await page.locator("[data-testid='workflow-v2-edge-layer'] path[marker-end='url(#workflow-v2-arrowhead)']").count() > 0);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 node inspectors are type-specific and agent fields are editable controls", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-node-config']");

    assert.equal(await page.locator("[data-action='add-workflow-v2-node'][data-node-type='llm']").count(), 0);
    assert.equal(await page.locator("[data-action='add-workflow-v2-node'][data-node-type='tool']").count(), 0);
    assert.equal(await page.locator("[data-action='add-workflow-v2-node'][data-node-type='output']").count(), 0);

    await page.locator("button.workflow-v2-node[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-agent-goal']");
    assert.ok(await page.locator("[data-testid='workflow-v2-output-schema-builder']").isVisible());
    assert.ok(await page.locator("[data-testid='workflow-v2-tool-policy']").isVisible());
    assert.ok(await page.locator("[data-testid='workflow-v2-agent-branch-summary']").isVisible());
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-branch-next-node-id']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-workflow-run-input-label']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-run-input']").count(), 0);
    await page.locator("[data-testid='workflow-v2-agent-instruction']").fill("Analyze A");
    await page.locator("[data-testid='workflow-v2-run-input']").fill("workflow-level input");
    await page.locator("[data-node-id='technical-answer']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-run-input']").inputValue(), "workflow-level input");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-run-input']").count(), 0);
    await page.locator("[data-testid='workflow-v2-agent-instruction']").fill("Technical B");

    await page.locator("[data-node-id='route-category']").click();
    await page.waitForSelector("[data-testid='workflow-v2-condition-inspector']");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-goal']").count(), 0);
    const initialConditionEdges = await edgeRowCount(page);
    await page.locator("[data-testid='workflow-v2-condition-branch-handle']").fill("other");
    await page.locator("[data-testid='workflow-v2-condition-source-field']").selectOption("analyze-request:category");
    await page.locator("[data-testid='workflow-v2-condition-value']").fill("other");
    await page.locator("[data-testid='workflow-v2-condition-target']").selectOption("end-1");
    await page.locator("[data-action='add-workflow-v2-condition-branch']").click();
    assert.equal(await edgeRowCount(page), initialConditionEdges + 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-layer'] path[marker-end]").count(), initialConditionEdges + 1);
    assert.equal(await page.locator(".workflow-v2-edge-row input[aria-label='Edge handle'][value='other']").count(), 1);

    await page.locator("[data-node-id='end-1']").click();
    await page.waitForSelector("[data-testid='workflow-v2-end-inspector']");
    assert.equal(await page.locator("[data-testid='workflow-v2-condition-inspector']").count(), 0);

    await page.locator("[data-action='add-workflow-v2-node'][data-node-type='workflow']").click();
    await page.locator("[data-node-id='workflow-1']").click();
    await page.waitForSelector("[data-testid='workflow-v2-workflow-inspector']");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-goal']").count(), 0);

    await page.locator("[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-agent-goal']");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-instruction']").inputValue(), "Analyze A");
    await page.locator("[data-node-id='technical-answer']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-instruction']").inputValue(), "Technical B");
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 Agent input schema and binding controls use structured sources", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.locator("[data-action='add-workflow-v2-node'][data-node-type='agent']").click();
    await page.locator("[data-node-id='agent-1']").click();
    await page.waitForSelector("[data-testid='workflow-v2-agent-input-bindings']");
    await page.locator("[data-testid='workflow-v2-input-field-name']").fill("query");
    await page.locator("[data-action='add-workflow-v2-input-field']").click();

    assert.equal(await page.locator("[data-testid='workflow-v2-agent-input-query']").count(), 1);
    await page.locator("[data-testid='workflow-v2-agent-input-query-source']").selectOption("workflow_input");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-input-query-workflow']").count(), 1);
    await page.locator("[data-testid='workflow-v2-agent-input-query-workflow']").selectOption("message");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-input-query-source']").inputValue(), "workflow_input");
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 condition inspector displays the configured default branch", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.locator("[data-node-id='route-category']").click();
    await page.waitForSelector("[data-testid='workflow-v2-condition-inspector']");

    const defaultBranch = page.locator("[data-testid='workflow-v2-condition-default-branch']");
    assert.equal(await defaultBranch.count(), 1);
    assert.match(await defaultBranch.textContent(), /default\s*->\s*general-answer/);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 condition output handles stay aligned to the right of the node", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-node-id='route-category']");

    const geometry = await page.evaluate(() => {
      const node = document.querySelector("button[data-node-id='route-category']").getBoundingClientRect();
      const handles = [...document.querySelectorAll("button[data-source-id='route-category']")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right };
      });
      return { node: { right: node.right, top: node.top, bottom: node.bottom }, handles };
    });

    assert.deepEqual(geometry.handles.map((handle) => Math.round(handle.left >= geometry.node.right)), [1, 1, 1]);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 run shows the selected node execution trace and real payload sections", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.locator("[data-testid='workflow-v2-publish']").click();
    await page.locator("[data-testid='workflow-v2-run-input']").fill("trace request");
    await page.locator("[data-testid='workflow-v2-run']").click();
    await page.waitForSelector("[data-testid='workflow-v2-execution-trace']");

    assert.ok(await page.locator("[data-testid='workflow-v2-execution-row']").count() > 0);
    await page.locator("button.workflow-v2-node[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-node-execution-analyze-request']");
    assert.equal(await page.locator("[data-testid='workflow-v2-node-input']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-node-output']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-node-status-analyze-request']").textContent(), "Success");
  } finally {
    await browser.close();
    await studio.close();
  }
});

async function workbenchState(page) {
  return page.evaluate(() => {
    const surface = document.querySelector("[data-testid='workflow-v2-workbench']");
    const canvas = document.querySelector("[data-testid='workflow-v2-canvas']");
    return {
      scrollTop: canvas.scrollTop,
      edgeCount: document.querySelectorAll(".workflow-v2-edge-row").length,
      rootProbe: surface.dataset.probeRoot,
      canvasProbe: canvas.dataset.probeCanvas,
    };
  });
}

async function edgeRowCount(page) {
  return page.locator(".workflow-v2-edge-row").count();
}

async function startStudio() {
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/dev-server.mjs", "--mock"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      CONTEXTOS_STUDIO_PORT: String(port),
    },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  return {
    url,
    close() {
      child.kill();
      return once(child, "exit").catch(() => {});
    },
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/__contextos/config.json`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Studio dev server did not start at ${url}`);
}
