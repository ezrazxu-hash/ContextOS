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

test("Workflow V2 node selection preserves the canvas viewport across selection and edits", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-node-config']");

    await page.evaluate(() => {
      const canvas = document.querySelector("[data-testid='workflow-v2-canvas']");
      canvas.style.height = "360px";
      canvas.style.maxHeight = "360px";
    });
    const canvas = page.locator("[data-testid='workflow-v2-canvas']");
    await canvas.hover();
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -500);
    await page.keyboard.up("Control");
    await page.evaluate(() => {
      const canvasElement = document.querySelector("[data-testid='workflow-v2-canvas']");
      canvasElement.scrollLeft = Math.min(180, canvasElement.scrollWidth - canvasElement.clientWidth);
      canvasElement.scrollTop = Math.min(40, canvasElement.scrollHeight - canvasElement.clientHeight);
      document.querySelector("[data-testid='workflow-v2-workbench']").dataset.probeRoot = "before-selection";
      canvasElement.dataset.probeCanvas = "before-selection";
    });

    const before = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.match(before.transform, /^scale\(/);

    await page.evaluate(() => document.querySelector("button.workflow-v2-node[data-node-id='analyze-request']").click());
    const afterFirstSelection = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterFirstSelection, before);
    assert.equal(await page.locator("[data-testid='workflow-v2-workbench']").getAttribute("data-probe-root"), "before-selection");
    assert.equal(await canvas.getAttribute("data-probe-canvas"), "before-selection");

    await page.locator("[data-testid='workflow-v2-agent-instruction']").fill("Updated instruction");
    const afterEdit = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterEdit, before);

    await page.evaluate(() => document.querySelector("button.workflow-v2-node[data-node-id='technical-answer']").click());
    const afterSecondSelection = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterSecondSelection, before);

    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").click();
    const afterBottomPanelTabs = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterBottomPanelTabs, before);

    await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").click();
    const afterBottomPanelClose = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterBottomPanelClose, before);

    await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").click();
    const afterBottomPanelReopen = await canvas.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
      transform: element.querySelector(".graph-canvas-content")?.style.transform ?? "",
    }));
    assert.deepEqual(afterBottomPanelReopen, before);
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
    const contextPolicy = page.locator("[data-testid='workflow-v2-agent-context-policy']");
    assert.deepEqual(await contextPolicy.locator("option").evaluateAll((options) => options.map((option) => option.value)), [
      "fullHistory",
      "currentTurn",
      "currentGroup",
      "explicitInputsOnly",
    ]);
    await contextPolicy.selectOption("currentTurn");
    assert.equal(await contextPolicy.inputValue(), "currentTurn");
    assert.ok(await page.locator("[data-testid='workflow-v2-output-schema-builder']").isVisible());
    assert.ok(await page.locator("[data-testid='workflow-v2-tool-policy']").isVisible());
    assert.ok(await page.locator("[data-testid='workflow-v2-agent-branch-summary']").isVisible());
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-branch-next-node-id']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-workflow-run-input-label']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-run-input']").count(), 0);
    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-workflow-run-input-label']").count(), 1);
    await page.locator("[data-testid='workflow-v2-agent-instruction']").fill("Analyze A");
    await page.locator("[data-testid='workflow-v2-run-input']").fill("workflow-level input");
    await page.locator("[data-node-id='technical-answer']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-run-input']").inputValue(), "workflow-level input");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-run-input']").count(), 0);
    await page.locator("[data-testid='workflow-v2-agent-instruction']").fill("Technical B");

    await page.locator("[data-node-id='route-category']").click();
    await page.waitForSelector("[data-testid='workflow-v2-condition-inspector']");
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-goal']").count(), 0);
    await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").click();
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
    const workflowContextMode = page.locator("[data-testid='workflow-v2-workflow-context-mode']");
    await workflowContextMode.selectOption("isolated");
    assert.equal(await workflowContextMode.inputValue(), "isolated");

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

test("Workflow V2 tool policy keeps tool and Agent checkboxes on one row", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.locator("[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-tool-policy'] .workflow-v2-check");

    const layout = await page.locator("[data-testid='workflow-v2-tool-policy'] .workflow-v2-tool-list").evaluate((list) => {
      const labels = [...list.querySelectorAll(".workflow-v2-check")];
      const firstToolLabel = labels[0];
      const firstAgentLabel = labels[1];
      const toolCheckbox = firstToolLabel?.querySelector("input[type='checkbox']");
      const agentCheckbox = firstAgentLabel?.querySelector("input[type='checkbox']");
      const toolMode = document.querySelector("[data-testid='workflow-v2-tool-mode']");
      const contextPolicy = document.querySelector("[data-testid='workflow-v2-agent-context-policy']");
      const modeRect = toolMode?.getBoundingClientRect();
      const contextRect = contextPolicy?.getBoundingClientRect();

      for (const name of ["A deliberately long tool display name for overflow checking", "Second additional tool name"]) {
        const toolLabel = firstToolLabel.cloneNode(true);
        const agentLabel = firstAgentLabel.cloneNode(true);
        toolLabel.querySelector("input").removeAttribute("data-workflow-v2-workflow-tool");
        agentLabel.querySelector("input").removeAttribute("data-workflow-v2-agent-tool");
        toolLabel.querySelector(".workflow-v2-tool-name").textContent = name;
        list.append(toolLabel, agentLabel);
      }

      const configPanel = document.querySelector("[data-testid='workflow-v2-node-config']");
      const previousWidth = configPanel.style.width;
      configPanel.style.width = "250px";
      const narrowLabels = [...list.querySelectorAll(".workflow-v2-check")];
      const narrowLayout = {
        listWidth: list.clientWidth,
        listScrollWidth: list.scrollWidth,
        rows: Array.from({ length: narrowLabels.length / 2 }, (_, index) => ({
          toolTop: narrowLabels[index * 2].getBoundingClientRect().top,
          agentTop: narrowLabels[index * 2 + 1].getBoundingClientRect().top,
        })),
        toolNameStyles: (() => {
          const name = narrowLabels[2]?.querySelector(".workflow-v2-tool-name");
          return name ? {
            whiteSpace: getComputedStyle(name).whiteSpace,
            overflow: getComputedStyle(name).overflow,
            textOverflow: getComputedStyle(name).textOverflow,
          } : null;
        })(),
      };
      configPanel.style.width = previousWidth;
      for (const label of narrowLabels.slice(2)) label.remove();

      return {
        labelCount: labels.length,
        firstToolTop: firstToolLabel?.getBoundingClientRect().top ?? 0,
        firstAgentTop: firstAgentLabel?.getBoundingClientRect().top ?? 0,
        toolCheckbox: toolCheckbox ? {
          width: toolCheckbox.getBoundingClientRect().width,
          height: toolCheckbox.getBoundingClientRect().height,
        } : null,
        agentCheckbox: agentCheckbox ? {
          width: agentCheckbox.getBoundingClientRect().width,
          height: agentCheckbox.getBoundingClientRect().height,
        } : null,
        selectDimensionsMatch: Boolean(modeRect && contextRect)
          && Math.abs(modeRect.width - contextRect.width) < 1
          && Math.abs(modeRect.height - contextRect.height) < 1,
        narrowLayout,
      };
    });

    assert.equal(layout.labelCount, 2);
    assert.ok(Math.abs(layout.firstToolTop - layout.firstAgentTop) < 1);
    assert.deepEqual(layout.toolCheckbox, { width: 16, height: 16 });
    assert.deepEqual(layout.agentCheckbox, { width: 16, height: 16 });
    assert.equal(layout.selectDimensionsMatch, true);
    assert.equal(layout.narrowLayout.rows.length, 3);
    assert.ok(layout.narrowLayout.rows.every((row) => Math.abs(row.toolTop - row.agentTop) < 1));
    assert.ok(layout.narrowLayout.listScrollWidth <= layout.narrowLayout.listWidth);
    assert.deepEqual(layout.narrowLayout.toolNameStyles, {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });

    const contextPolicy = page.locator("[data-testid='workflow-v2-agent-context-policy']");
    await contextPolicy.selectOption("currentTurn");
    await page.locator("[data-testid='workflow-v2-tool-mode']").selectOption("auto");
    const workflowTool = page.locator("[data-workflow-v2-workflow-tool='context.echo']");
    const workflowToolWasChecked = await workflowTool.isChecked();
    await workflowTool.click();
    assert.equal(await page.locator("[data-workflow-v2-workflow-tool='context.echo']").isChecked(), !workflowToolWasChecked);
    const agentTool = page.locator("[data-workflow-v2-agent-tool='context.echo']");
    const agentToolWasChecked = await agentTool.isChecked();
    await agentTool.click();
    assert.equal(await page.locator("[data-workflow-v2-agent-tool='context.echo']").isChecked(), !agentToolWasChecked);
    assert.equal(await page.locator("[data-testid='workflow-v2-agent-context-policy']").inputValue(), "currentTurn");
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 tool changes preserve the right inspector scroll container", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.locator("[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-tool-policy'] [data-workflow-v2-workflow-tool]");

    const before = await page.locator("[data-testid='workflow-v2-node-config']").evaluate((panel) => {
      const tools = panel.querySelector("[data-testid='workflow-v2-tool-policy']");
      const panelRect = panel.getBoundingClientRect();
      const toolsRect = tools.getBoundingClientRect();
      panel.scrollTop = Math.min(panel.scrollHeight - panel.clientHeight, panel.scrollTop + toolsRect.top - panelRect.top - 12);
      panel.dataset.scrollProbe = "agent-tools";
      return { scrollTop: panel.scrollTop, probe: panel.dataset.scrollProbe };
    });
    assert.ok(before.scrollTop > 0);

    const assertPanelPreserved = async () => {
      const after = await page.locator("[data-testid='workflow-v2-node-config']").evaluate((panel) => ({
        scrollTop: panel.scrollTop,
        probe: panel.dataset.scrollProbe ?? null,
      }));
      assert.deepEqual(after, before);
    };

    await page.locator("[data-testid='workflow-v2-tool-mode']").selectOption("auto");
    await assertPanelPreserved();

    await page.locator("[data-workflow-v2-agent-tool='context.echo']").check();
    await assertPanelPreserved();

    await page.locator("[data-testid='workflow-v2-tool-mode']").selectOption("required");
    await assertPanelPreserved();
    await page.locator("[data-workflow-v2-workflow-tool='context.echo']").uncheck();
    await assertPanelPreserved();
    await page.locator("[data-testid='workflow-v2-tool-mode']").selectOption("disabled");
    await assertPanelPreserved();

    const instruction = page.locator("[data-testid='workflow-v2-agent-instruction']");
    await instruction.scrollIntoViewIfNeeded();
    const beforeAgentEdit = await page.locator("[data-testid='workflow-v2-node-config']").evaluate((panel) => ({
      scrollTop: panel.scrollTop,
      probe: panel.dataset.scrollProbe ?? null,
    }));
    await instruction.fill("Updated without moving the inspector");
    const afterAgentEdit = await page.locator("[data-testid='workflow-v2-node-config']").evaluate((panel) => ({
      scrollTop: panel.scrollTop,
      probe: panel.dataset.scrollProbe ?? null,
    }));
    assert.deepEqual(afterAgentEdit, beforeAgentEdit);

    await page.locator("[data-node-id='technical-answer']").click();
    await page.waitForSelector("[data-testid='workflow-v2-agent-goal']");
    assert.equal(await page.locator(".workflow-v2-node[data-node-id='technical-answer'].selected").count(), 1);
    assert.notEqual(await page.locator("[data-testid='workflow-v2-agent-instruction']").inputValue(), "Updated without moving the inspector");
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
    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    await page.locator("[data-testid='workflow-v2-run-input']").fill("trace request");
    await page.locator("[data-testid='workflow-v2-run-submit']").click();
    await page.waitForSelector("[data-testid='workflow-v2-run-output']");
    assert.ok((await page.locator("[data-testid='workflow-v2-run-output']").textContent()).includes("trace request"));

    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    await page.waitForSelector("[data-testid='workflow-v2-execution-trace']");

    assert.ok(await page.locator("[data-testid='workflow-v2-execution-row']").count() > 0);
    await page.locator("button.workflow-v2-node[data-node-id='analyze-request']").click();
    await page.waitForSelector("[data-testid='workflow-v2-node-execution-analyze-request']");
    const selectedInput = page.locator("[data-testid='workflow-v2-node-input']");
    const selectedOutput = page.locator("[data-testid='workflow-v2-node-output']");
    assert.equal(await selectedInput.count(), 1);
    assert.equal(await selectedOutput.count(), 1);
    assert.equal(await selectedInput.locator("details").getAttribute("open"), "");
    assert.equal(await selectedOutput.locator("details").getAttribute("open"), "");
    await selectedInput.locator("details > summary").click();
    assert.equal(await selectedInput.locator("details").getAttribute("open"), null);
    await selectedOutput.locator("details > summary").click();
    assert.equal(await selectedOutput.locator("details").getAttribute("open"), null);
    assert.equal(await page.locator("[data-testid='workflow-v2-node-status-analyze-request']").textContent(), "Success");

    await page.locator("[data-testid='workflow-v2-execution-row'][data-node-id='technical-answer']").click();
    await page.waitForSelector("[data-testid='workflow-v2-node-execution-technical-answer']");
    assert.equal(await page.locator("[data-testid='workflow-v2-node-output'] details").getAttribute("open"), "");

    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-run-input']").inputValue(), "trace request");
    assert.equal(await page.locator("[data-testid='workflow-v2-run-output']").count(), 1);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 bottom panel switches between execution trace and edge relations", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-bottom-panel']");

    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-tab-run']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-execution-trace']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-panel']").count(), 1);

    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-execution-trace']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-panel']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").getAttribute("aria-selected"), "true");

    const traceHeight = await page.locator("[data-testid='workflow-v2-canvas']").evaluate((element) => element.getBoundingClientRect().height);

    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-execution-trace']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-panel']").count(), 0);
    const closedHeight = await page.locator("[data-testid='workflow-v2-canvas']").evaluate((element) => element.getBoundingClientRect().height);
    assert.ok(closedHeight > traceHeight);

    await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-edge-panel']").count(), 1);
    assert.equal(await page.locator("[data-testid='workflow-v2-execution-trace']").count(), 0);
    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-tab-edge-relations']").getAttribute("aria-selected"), "true");

    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-run-panel']").count(), 1);
    await page.locator("[data-testid='workflow-v2-bottom-tab-run']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-run-panel']").count(), 0);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 layout collapses Context by default and preserves Basic Info while collapsed", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-node-config']");

    const rightPanel = page.locator("[data-testid='right-panel']");
    assert.equal(await rightPanel.getAttribute("data-collapsed"), "true");
    assert.equal(await page.locator("[data-testid='toggle-right-panel']").getAttribute("aria-label"), "Expand Context");
    const collapsedMainWidth = await page.locator("[data-testid='main-pane']").evaluate((element) => element.getBoundingClientRect().width);
    await page.locator("[data-testid='toggle-right-panel']").click();
    assert.equal(await rightPanel.getAttribute("data-collapsed"), "false");
    assert.equal(await page.locator("[data-testid='toggle-right-panel']").getAttribute("aria-label"), "Collapse Context");
    const expandedMainWidth = await page.locator("[data-testid='main-pane']").evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(expandedMainWidth < collapsedMainWidth);
    await page.locator("[data-testid='toggle-right-panel']").click();
    assert.equal(await rightPanel.getAttribute("data-collapsed"), "true");

    await page.locator("[data-node-id='analyze-request']").click();
    const instruction = page.locator("[data-testid='workflow-v2-agent-instruction']");
    await instruction.fill("Keep this value");
    await page.locator("[data-testid='workflow-v2-basic-info-toggle']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-basic-info-content']").count(), 0);
    await page.locator("[data-testid='workflow-v2-basic-info-toggle']").click();
    assert.equal(await instruction.inputValue(), "Keep this value");
    assert.equal(await page.locator("[data-node-id='analyze-request'].selected").count(), 1);
  } finally {
    await browser.close();
    await studio.close();
  }
});

test("Workflow V2 bottom panel resizes within bounds and preserves height across tabs and close", async () => {
  const studio = await startStudio();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

  try {
    await page.goto(`${studio.url}/workflow`);
    await page.waitForSelector("[data-testid='workflow-v2-bottom-resize-handle']");

    const initial = await workflowLayoutMetrics(page);
    await dragBottomPanel(page, -120);
    const enlarged = await workflowLayoutMetrics(page);
    assert.ok(enlarged.panelHeight > initial.panelHeight);
    assert.ok(enlarged.canvasHeight < initial.canvasHeight);
    assert.ok(enlarged.panelHeight >= enlarged.minHeight);
    assert.ok(enlarged.panelHeight <= enlarged.maxHeight);

    await dragBottomPanel(page, 80);
    const reduced = await workflowLayoutMetrics(page);
    assert.ok(reduced.panelHeight < enlarged.panelHeight);
    assert.ok(reduced.canvasHeight > enlarged.canvasHeight);

    await dragBottomPanel(page, -2000);
    const maximum = await workflowLayoutMetrics(page);
    assert.equal(Math.round(maximum.panelHeight), maximum.maxHeight);
    await dragBottomPanel(page, 2000);
    const minimum = await workflowLayoutMetrics(page);
    assert.equal(Math.round(minimum.panelHeight), minimum.minHeight);

    const rememberedHeight = minimum.panelHeight;
    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    assert.ok(Math.abs((await workflowLayoutMetrics(page)).panelHeight - rememberedHeight) < 1);
    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    assert.equal(await page.locator("[data-testid='workflow-v2-bottom-content']").count(), 0);
    await page.locator("[data-testid='workflow-v2-bottom-tab-execution-trace']").click();
    assert.ok(Math.abs((await workflowLayoutMetrics(page)).panelHeight - rememberedHeight) < 1);
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

async function workflowLayoutMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-testid='workflow-v2-bottom-panel']");
    const canvas = document.querySelector("[data-testid='workflow-v2-canvas']");
    const handle = document.querySelector("[data-testid='workflow-v2-bottom-resize-handle']");
    return {
      panelHeight: panel.getBoundingClientRect().height,
      canvasHeight: canvas.getBoundingClientRect().height,
      minHeight: Number(handle?.getAttribute("aria-valuemin")),
      maxHeight: Number(handle?.getAttribute("aria-valuemax")),
    };
  });
}

async function dragBottomPanel(page, deltaY) {
  const box = await page.locator("[data-testid='workflow-v2-bottom-resize-handle']").boundingBox();
  assert.ok(box);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + deltaY, { steps: 5 });
  await page.mouse.up();
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
