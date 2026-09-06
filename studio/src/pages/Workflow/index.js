export const WorkflowPage = {
  kind: "studio-page",
  name: "Workflow",
};

export async function createWorkflowPage(apiClient, options = {}) {
  const { createWorkflowV2Workbench } = await import("./WorkflowV2Workbench.js");
  return createWorkflowV2Workbench({
    ...options,
    apiClient,
    workflowDefinition: workflowV2DefinitionForPage(options.workflowDefinition),
  });
}

export function workflowEditorKindForDefinition(definition = null) {
  void definition;
  return "agent-workflow-v2";
}

export function createNewWorkflowDefinition({ id = "new-agent-workflow", name = "New Agent Workflow" } = {}) {
  return {
    id,
    name,
    schemaVersion: 2,
    nodes: [],
    edges: [],
    tools: [],
    runtimeLimits: {},
  };
}

export function createStarterWorkflowV2Definition({ id = "new-agent-workflow", name = "New Agent Workflow" } = {}) {
  return {
    id,
    name,
    schemaVersion: 2,
    revision: 1,
    inputSchema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["summary", "category"],
      properties: {
        summary: { type: "string" },
        category: { type: "string" },
      },
    },
    tools: ["context.echo"],
    nodes: [
      {
        id: "analyze-request",
        type: "agent",
        position: { x: 80, y: 160 },
        config: {
          name: "Analyze Request",
          instruction: [
            "Read the workflow input message and classify it as technical, business, or general.",
            "You may call context.echo with the message as query when you need a tool smoke check.",
            "Return only JSON that matches the output schema.",
          ].join(" "),
          visibility: "visible",
          toolPolicy: { mode: "auto", allowedTools: ["context.echo"] },
          outputSchema: {
            type: "object",
            required: ["category", "topic", "confidence", "summary"],
            properties: {
              category: { type: "string", enum: ["technical", "business", "general"] },
              topic: { type: "string" },
              confidence: { type: "number" },
              summary: { type: "string" },
            },
          },
        },
      },
      {
        id: "route-category",
        type: "condition",
        position: { x: 340, y: 160 },
        config: {
          branches: [
            {
              handle: "technical",
              source: { nodeId: "analyze-request", path: ["category"] },
              operator: "equals",
              value: "technical",
              target: "technical-answer",
            },
            {
              handle: "business",
              source: { nodeId: "analyze-request", path: ["category"] },
              operator: "equals",
              value: "business",
              target: "business-answer",
            },
          ],
          defaultTarget: "general-answer",
        },
      },
      agentAnswerNode(
        "technical-answer",
        "Technical Answer",
        "Answer as a technical assistant. Use the prior message history and the Analyze Request result. Return JSON with summary and category.",
        { x: 620, y: 80 },
      ),
      agentAnswerNode(
        "business-answer",
        "Business Answer",
        "Answer as a business assistant. Use the prior message history and the Analyze Request result. Return JSON with summary and category.",
        { x: 620, y: 220 },
      ),
      agentAnswerNode(
        "general-answer",
        "General Answer",
        "Answer as a general assistant. Use the prior message history and the Analyze Request result. Return JSON with summary and category.",
        { x: 620, y: 360 },
      ),
      agentAnswerNode(
        "generate-final",
        "Generate Final",
        "Create the final concise response from the active branch result. Return JSON with summary and category.",
        { x: 900, y: 220 },
      ),
      {
        id: "end-1",
        type: "end",
        position: { x: 1160, y: 220 },
        config: {
          finalResult: {
            message: { mode: "lastVisibleAssistant" },
            artifacts: { mode: "allVisible" },
            data: { kind: "nodeOutput", nodeId: "generate-final", path: ["summary"] },
          },
        },
      },
    ],
    edges: [
      { source: "START", target: "analyze-request" },
      { source: "analyze-request", target: "route-category" },
      { source: "route-category", target: "technical-answer", sourceHandle: "technical" },
      { source: "route-category", target: "business-answer", sourceHandle: "business" },
      { source: "route-category", target: "general-answer", sourceHandle: "default" },
      { source: "technical-answer", target: "generate-final" },
      { source: "business-answer", target: "generate-final" },
      { source: "general-answer", target: "generate-final" },
      { source: "generate-final", target: "end-1" },
    ],
    runtimeLimits: {},
  };
}

function workflowV2DefinitionForPage(definition) {
  if (Number(definition?.schemaVersion ?? definition?.schema_version ?? 0) === 2) {
    return definition;
  }
  return createStarterWorkflowV2Definition({
    id: definition?.id ?? definition?.template?.id ?? "new-agent-workflow",
    name: definition?.name ?? definition?.template?.name ?? "New Agent Workflow",
  });
}

function agentAnswerNode(id, name, instruction, position) {
  return {
    id,
    type: "agent",
    position,
    config: {
      name,
      instruction,
      visibility: "visible",
      toolPolicy: { mode: "disabled" },
      outputSchema: {
        type: "object",
        required: ["summary", "category"],
        properties: {
          summary: { type: "string" },
          category: { type: "string" },
        },
      },
    },
  };
}
