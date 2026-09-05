import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const studioRoot = dirname(fileURLToPath(import.meta.url)).replace(/\\tests$/, "");

function moduleUrl(relativePath) {
  return pathToFileURL(join(studioRoot, relativePath)).href;
}

test("T04 V2 schema builder generates MVP JSON Schema fields and required list", async () => {
  const { createWorkflowV2SchemaBuilder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2SchemaBuilder.js"));
  const builder = createWorkflowV2SchemaBuilder();

  builder.addField({ name: "category", type: "enum", required: true, enumOptions: ["technical", "business", "other"], description: "Need type" });
  builder.addField({ name: "summary", type: "string", required: true, description: "Short summary" });
  builder.addField({ name: "confidence", type: "number" });
  builder.addField({ name: "accepted", type: "boolean" });

  assert.deepEqual(builder.toJsonSchema(), {
    type: "object",
    required: ["category", "summary"],
    properties: {
      category: { type: "string", enum: ["technical", "business", "other"], description: "Need type" },
      summary: { type: "string", description: "Short summary" },
      confidence: { type: "number" },
      accepted: { type: "boolean" },
    },
  });
});

test("T04 V2 schema builder supports object children, array items, delete, and round-trip", async () => {
  const { createWorkflowV2SchemaBuilder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2SchemaBuilder.js"));
  const builder = createWorkflowV2SchemaBuilder({
    type: "object",
    required: ["summary", "metadata"],
    properties: {
      summary: { type: "string" },
      metadata: {
        type: "object",
        required: ["source"],
        properties: {
          source: { type: "string" },
          score: { type: "number" },
        },
      },
      tags: { type: "array", items: { type: "string" } },
      stale: { type: "boolean" },
    },
  });

  builder.removeField("stale");
  builder.updateArrayItem("tags", { type: "integer" });

  assert.deepEqual(builder.view().fields.map((field) => [field.name, field.type, field.required]), [
    ["summary", "string", true],
    ["metadata", "object", true],
    ["tags", "array", false],
  ]);
  assert.deepEqual(builder.toJsonSchema(), {
    type: "object",
    required: ["summary", "metadata"],
    properties: {
      summary: { type: "string" },
      metadata: {
        type: "object",
        required: ["source"],
        properties: {
          source: { type: "string" },
          score: { type: "number" },
        },
      },
      tags: { type: "array", items: { type: "integer" } },
    },
  });
});

test("T04 V2 schema builder reports field-local errors for invalid input", async () => {
  const { createWorkflowV2SchemaBuilder } = await import(moduleUrl("src/features/workflow-v2/WorkflowV2SchemaBuilder.js"));
  const builder = createWorkflowV2SchemaBuilder();

  builder.addField({ name: "", type: "string", required: true });
  builder.addField({ name: "category", type: "enum", enumOptions: [] });
  builder.addField({ name: "category", type: "number" });

  const validation = builder.validate();

  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.errors.map((error) => [error.field, error.code]),
    [
      ["fields[0].name", "field_name_required"],
      ["fields[1].enumOptions", "enum_options_required"],
      ["fields[2].name", "duplicate_field_name"],
    ],
  );
});
