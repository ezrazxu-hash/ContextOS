import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const repoRoot = dirname(studioRoot);
const specPath = join(repoRoot, "docs/ui/contextos-studio-visual-spec.md");

function readSpec() {
  assert.ok(existsSync(specPath), "missing ContextOS Studio visual spec");
  return readFileSync(specPath, "utf-8");
}

function p0Rows(spec) {
  return spec.split("\n").filter((line) => /^\|\s*P0-/.test(line));
}

test("UI00-T01 visual spec maps all four reference images to Studio pages", () => {
  const spec = readSpec();

  for (const image of [
    "01-contextos-product-architecture.png",
    "02-contextos-chat-workbench.png",
    "03-contextos-workflow-builder.png",
    "04-contextos-debug-view.png",
  ]) {
    assert.match(spec, new RegExp(image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const page of ["App Shell", "Chat", "Workflow", "Template", "Debug"]) {
    assert.match(spec, new RegExp(`## ${page}`));
  }
});

test("UI00-T01 every P0 visual region traces to an implementation task or component", () => {
  const spec = readSpec();
  const rows = p0Rows(spec);

  assert.ok(rows.length >= 12, "expected P0 rows for the core Studio regions");
  for (const row of rows) {
    assert.match(row, /M\d{2}-T\d{2}|UI\d{2}-T\d{2}|studio\/src\//, row);
    assert.doesNotMatch(row, /TBD|TODO|Unmapped/i, row);
  }
});

test("UI00-T01 visual spec classifies page states and keeps V1 exclusions out of P0", () => {
  const spec = readSpec();

  for (const state of ["Loading", "Empty", "Error", "Refresh / Rehydrate"]) {
    assert.match(spec, new RegExp(`\\b${state}\\b`));
  }

  for (const row of p0Rows(spec)) {
    assert.doesNotMatch(row, /Desktop|Marketplace|Branch Merge/i, row);
  }

  assert.match(spec, /V1 Exclusions/);
  assert.match(spec, /Desktop Client[\s\S]*Deferred/);
  assert.match(spec, /Marketplace[\s\S]*Excluded/);
  assert.match(spec, /Branch Merge[\s\S]*Excluded/);
});
