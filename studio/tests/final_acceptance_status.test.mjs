import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const repoRoot = dirname(studioRoot);
const planPath = join(repoRoot, "RequirementsAndTasks/ContextOS-V1-Studio-Web-Client-Supplement-Task-Plan.md");

test("final runnable Studio acceptance checklist has no unchecked items", () => {
  const plan = readFileSync(planPath, "utf-8");
  const finalSectionStart = plan.search(/^# 7\./m);
  assert.notEqual(finalSectionStart, -1);
  const finalAcceptance = plan.slice(finalSectionStart);
  const unchecked = finalAcceptance.match(/^- \[ \] .+$/gm) ?? [];

  assert.deepEqual(unchecked, []);
});
