import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");
const repoRoot = dirname(studioRoot);
const boundaryDocPath = join(repoRoot, "docs/ui/multi-client-boundary.md");

test("UI10-T04-TC01: V1 only requires Desktop boundary documentation, not a Desktop build", () => {
  assert.ok(existsSync(boundaryDocPath), "missing multi-client boundary document");
  const doc = readFileSync(boundaryDocPath, "utf-8");

  assert.match(doc, /V1 does not require a Desktop build/i);
});

test("UI10-T04-TC02: future Desktop work must reuse Runtime API and client-core", () => {
  const doc = readFileSync(boundaryDocPath, "utf-8");

  assert.match(doc, /same Runtime API/i);
  assert.match(doc, /client-core/i);
});

test("UI10-T04-TC03: Desktop must not copy LangGraph Runtime business logic", () => {
  const doc = readFileSync(boundaryDocPath, "utf-8");

  assert.match(doc, /must not copy or embed LangGraph Runtime business logic/i);
});
