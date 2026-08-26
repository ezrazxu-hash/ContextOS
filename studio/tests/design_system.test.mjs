import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("UI00-T02 light theme tokens define consistent visual hierarchy", async () => {
  const { lightThemeTokens } = await import(moduleUrl("src/design-system/tokens/index.js"));

  assert.deepEqual(Object.keys(lightThemeTokens.spacing), ["xs", "sm", "md", "lg", "xl"]);
  assert.ok(lightThemeTokens.spacing.xs < lightThemeTokens.spacing.sm);
  assert.ok(lightThemeTokens.spacing.sm < lightThemeTokens.spacing.md);
  assert.ok(lightThemeTokens.radius.panel <= 8);
  assert.equal(lightThemeTokens.status.danger.intent, "danger");
  assert.equal(lightThemeTokens.focus.ringStyle, "visible");
  assert.ok(lightThemeTokens.zIndex.dialog > lightThemeTokens.zIndex.popover);
});

test("UI00-T02 base components expose keyboard reachable contracts", async () => {
  const {
    createButton,
    createInput,
    createSelect,
    createTabs,
    createTooltip,
    createPopover,
    createDrawer,
    interactiveComponents,
  } = await import(moduleUrl("src/design-system/components/primitives.js"));

  const components = [
    createButton({ label: "Save" }),
    createInput({ label: "Session name" }),
    createSelect({ label: "Model", options: ["gpt-4o"] }),
    createTabs({ label: "Inspector", tabs: ["State", "Tool"] }),
    createTooltip({ label: "Trace id", content: "Copied from backend trace" }),
    createPopover({ label: "More actions" }),
    createDrawer({ title: "Context detail" }),
  ];

  assert.deepEqual(interactiveComponents(components).map((component) => component.role), [
    "button",
    "textbox",
    "combobox",
    "tablist",
    "tooltip-trigger",
    "button",
    "dialog-trigger",
  ]);
  for (const component of interactiveComponents(components)) {
    assert.equal(component.tabIndex, 0, component.role);
    assert.ok(component.ariaLabel || component.label || component.title, component.role);
  }
});

test("UI00-T02 dialog has focus lock Esc close rule and aria labels", async () => {
  const { createDialog } = await import(moduleUrl("src/design-system/components/primitives.js"));

  const dialog = createDialog({
    title: "Replay confirmation",
    description: "Choose how to handle side-effect tool calls.",
    danger: true,
  });

  assert.equal(dialog.role, "dialog");
  assert.equal(dialog.ariaModal, true);
  assert.equal(dialog.focusTrap, true);
  assert.equal(dialog.closeOnEsc, true);
  assert.equal(dialog.ariaLabelledBy, "dialog-title");
  assert.equal(dialog.ariaDescribedBy, "dialog-description");
  assert.equal(dialog.intent, "danger");
  assert.equal(dialog.dangerSemantics.textRequired, true);
});

test("UI00-T02 danger actions are not expressed by color alone", async () => {
  const { createButton, createBadge, createErrorState, createEmptyState, createSkeleton } = await import(
    moduleUrl("src/design-system/components/primitives.js")
  );

  const dangerButton = createButton({ label: "Reinvoke Tool", intent: "danger" });
  const dangerBadge = createBadge({ label: "External write", intent: "danger" });

  assert.equal(dangerButton.intent, "danger");
  assert.equal(dangerButton.requiresTextCue, true);
  assert.match(dangerButton.ariaLabel, /danger/i);
  assert.equal(dangerBadge.requiresTextCue, true);
  assert.equal(createSkeleton({ label: "Loading context" }).state, "loading");
  assert.equal(createEmptyState({ title: "No traces" }).state, "empty");
  assert.equal(createErrorState({ message: "Request failed", requestId: "req-1" }).requestId, "req-1");
});

test("UI08-T01-TC01: keyboard flow can switch session send message open context detail and close dialog", async () => {
  const { createKeyboardFlow, createSkipNavigation } = await import(moduleUrl("src/design-system/components/primitives.js"));

  const flow = createKeyboardFlow({
    steps: [
      { id: "switch-session", key: "Enter", targetRole: "combobox" },
      { id: "send-message", key: "Enter", targetRole: "button" },
      { id: "open-context-detail", key: "Enter", targetRole: "dialog-trigger" },
      { id: "close-dialog", key: "Escape", targetRole: "dialog" },
    ],
  });
  const skip = createSkipNavigation({ targetId: "main-content" });

  assert.equal(flow.keyboardOnly, true);
  assert.deepEqual(flow.steps.map((step) => step.reachable), [true, true, true, true]);
  assert.equal(skip.href, "#main-content");
  assert.equal(skip.tabIndex, 0);
});

test("UI08-T01-TC02: accessibility audit reports no critical violations for baseline controls", async () => {
  const { auditAccessibility, createButton, createDialog, createInput } = await import(moduleUrl("src/design-system/components/primitives.js"));

  const result = auditAccessibility([
    createInput({ label: "Message" }),
    createButton({ label: "Send" }),
    createDialog({ title: "Context detail", description: "Raw context content" }),
  ]);

  assert.deepEqual(result.criticalViolations, []);
});

test("UI08-T01-TC03: danger button has text and aria semantics", async () => {
  const { auditAccessibility, createButton } = await import(moduleUrl("src/design-system/components/primitives.js"));

  const dangerButton = createButton({ label: "Stop runtime", intent: "danger" });
  const result = auditAccessibility([dangerButton]);

  assert.equal(dangerButton.requiresTextCue, true);
  assert.match(dangerButton.ariaLabel, /danger/i);
  assert.deepEqual(result.criticalViolations, []);
});
