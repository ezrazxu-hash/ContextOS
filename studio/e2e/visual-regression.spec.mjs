import { expect, test } from "@playwright/test";
import { visualBaselines } from "../src/visual/visualBaselines.js";

for (const baseline of visualBaselines.pages) {
  test(`${baseline.id} golden screenshot`, async ({ page }) => {
    await page.setViewportSize(baseline.viewport);
    await page.setContent(renderBaselinePage(baseline));
    await expect(page).toHaveScreenshot(`${baseline.id}.png`);
  });
}

test("replay-danger-modal golden screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(renderModalBaseline());
  await expect(page).toHaveScreenshot(`${visualBaselines.riskModal.id}.png`);
});

test("workflow-selected-node-config golden screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(renderWorkflowSelectedBaseline());
  await expect(page).toHaveScreenshot(`${visualBaselines.workflowSelectedNode.id}.png`);
});

function renderBaselinePage(baseline) {
  return html(`
    <main class="shell">
      <nav>${baseline.page}</nav>
      <section class="page" data-state="${baseline.state}">
        ${baseline.regions.map((region) => `<div class="region">${region}</div>`).join("")}
      </section>
    </main>
  `);
}

function renderModalBaseline() {
  return html(`
    <main class="shell dimmed">
      <section class="page"><div class="region">conversation</div><div class="region">impact</div></section>
      <dialog open aria-modal="true">
        <h1>Replay confirmation</h1>
        <p>Side-effect tool calls require explicit review.</p>
        <button>Cancel</button><button class="danger">Reinvoke Tool</button>
      </dialog>
    </main>
  `);
}

function renderWorkflowSelectedBaseline() {
  return html(`
    <main class="shell">
      <nav>Workflow</nav>
      <section class="page selected">
        <div class="region">canvas: selected agent node</div>
        <div class="region">config panel: model tool context retry checkpoint</div>
      </section>
    </main>
  `);
}

function html(body) {
  return `
    <!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font: 14px Arial, sans-serif; color: #111827; background: #f8fafc; }
          .shell { display: grid; grid-template-columns: 220px 1fr; min-height: 800px; }
          nav { padding: 24px; background: #0f172a; color: white; font-weight: 700; }
          .page { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
          .region { min-height: 220px; border: 1px solid #cbd5e1; background: white; padding: 16px; }
          .selected .region:first-child { outline: 3px solid #2563eb; }
          .dimmed .page { opacity: .45; }
          dialog { width: 420px; border: 1px solid #991b1b; padding: 24px; }
          button { margin-right: 8px; padding: 8px 12px; }
          .danger { background: #b42318; color: white; }
        </style>
      </head>
      <body>${body}</body>
    </html>
  `;
}
