# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: studio-app-interactions.spec.mjs >> Workflow page lists saves reloads and preserves dragged node positions
- Location: e2e\studio-app-interactions.spec.mjs:71:1

# Error details

```
TypeError: expect(received).toBeCloseTo(expected, precision)

Matcher error: received value must be a number

Received has value: undefined
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - banner [ref=f1e4]:
    - generic [ref=f1e5]:
      - strong [ref=f1e6]: ContextOS
      - generic [ref=f1e7]: Agent Studio
    - navigation "Studio sections" [ref=f1e8]:
      - link "Chat" [ref=f1e9] [cursor=pointer]:
        - /url: /chat
      - link "Workflow" [ref=f1e10] [cursor=pointer]:
        - /url: /workflow
      - link "Template" [ref=f1e11] [cursor=pointer]:
        - /url: /template
      - link "Debug" [ref=f1e12] [cursor=pointer]:
        - /url: /debug
    - generic [ref=f1e13]: Real Runtime
  - generic [ref=f1e16]:
    - complementary [ref=f1e17]:
      - generic [ref=f1e18]:
        - heading "Workspace" [level=2] [ref=f1e19]
        - button "Collapse navigation" [ref=f1e20] [cursor=pointer]: <
      - generic [ref=f1e21]:
        - heading "Sessions" [level=3] [ref=f1e22]
        - button "demo-session runtime" [pressed] [ref=f1e24] [cursor=pointer]:
          - generic [ref=f1e25]: demo-session
          - generic [ref=f1e26]: runtime
      - generic [ref=f1e28]:
        - heading "Timelines" [level=3] [ref=f1e29]
        - button "demo-timeline active" [pressed] [ref=f1e30] [cursor=pointer]:
          - generic [ref=f1e31]: demo-timeline
          - generic [ref=f1e32]: active
      - button "New Session" [ref=f1e33] [cursor=pointer]
    - main [ref=f1e34]:
      - generic [ref=f1e35]:
        - generic [ref=f1e36]:
          - generic [ref=f1e37]:
            - heading "Workflow Builder" [level=1] [ref=f1e38]
            - paragraph [ref=f1e39]: Workflow manifests from Runtime.
          - generic [ref=f1e40]:
            - button "Add Agent" [ref=f1e41] [cursor=pointer]
            - button "Save" [ref=f1e42] [cursor=pointer]
        - generic [ref=f1e43]:
          - generic [ref=f1e44]:
            - generic [ref=f1e45]:
              - heading "Workflows" [level=2] [ref=f1e46]
              - button "+ New Workflow" [ref=f1e47] [cursor=pointer]
              - button "My Workflow A" [ref=f1e49] [cursor=pointer]
            - generic [ref=f1e50]:
              - heading "Node Library" [level=2] [ref=f1e51]
              - button "agent" [ref=f1e52] [cursor=pointer]
              - button "tool" [ref=f1e53] [cursor=pointer]
              - button "condition" [ref=f1e54] [cursor=pointer]
              - button "context operator" [ref=f1e55] [cursor=pointer]
              - button "output" [ref=f1e56] [cursor=pointer]
          - generic [ref=f1e57]:
            - button "agent" [ref=f1e58]
            - button "tool" [ref=f1e59]
          - generic [ref=f1e60]:
            - heading "Node Config" [level=2] [ref=f1e61]
            - generic [ref=f1e62]:
              - text: Name
              - textbox "Name" [ref=f1e63]: My Workflow A
            - generic [ref=f1e64]:
              - term [ref=f1e65]: ID
              - definition [ref=f1e66]: agent-1
              - term [ref=f1e67]: Type
              - definition [ref=f1e68]: agent
            - button "Apply Config" [ref=f1e69] [cursor=pointer]
    - complementary [ref=f1e70]:
      - generic [ref=f1e71]:
        - heading "Context" [level=2] [ref=f1e72]
        - button "Collapse inspector" [ref=f1e73] [cursor=pointer]: ">"
      - tablist [ref=f1e74]:
        - tab "Context" [selected] [ref=f1e75] [cursor=pointer]
        - tab "Impact" [ref=f1e76] [cursor=pointer]
        - tab "Trace" [ref=f1e77] [cursor=pointer]
      - paragraph [ref=f1e80]: No context API projection is available.
  - generic [ref=f1e81]: Workflow loaded
```

# Test source

```ts
  18  |   test.use({ video: "off" });
  19  | }
  20  | 
  21  | test("Studio app has working navigation chat send selection and disabled action feedback", async ({ page }) => {
  22  |   const backendPort = await freePort();
  23  |   const studioPort = await freePort();
  24  |   const backend = await startBackend(backendPort);
  25  |   const studio = await startStudio(studioPort, backendPort);
  26  | 
  27  |   try {
  28  |     await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
  29  |     await expect(page.getByTestId("main-title")).toHaveText("Chat Workbench");
  30  |     await expect(page.getByTestId("session-demo-session")).toHaveAttribute("aria-pressed", "true");
  31  | 
  32  |     const postRequest = page.waitForRequest((request) => {
  33  |       return request.method() === "POST" && request.url().includes("/api/sessions/demo-session/messages");
  34  |     });
  35  |     const streamResponse = page.waitForResponse((response) => {
  36  |       return response.url().includes("/sse/sessions/demo-session/chat") && response.status() === 200;
  37  |     });
  38  | 
  39  |     await page.getByTestId("composer-input").fill("Hello, please reply with OK");
  40  |     await page.getByTestId("send-message").click();
  41  | 
  42  |     const request = await postRequest;
  43  |     expect(request.postDataJSON()).toMatchObject({ role: "user", content: "Hello, please reply with OK" });
  44  |     await streamResponse;
  45  |     await expect(page.getByText("Hello, please reply with OK")).toBeVisible();
  46  |     await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
  47  |     await expect(page.getByTestId("status-toast")).toContainText("Sent");
  48  | 
  49  |     await page.reload();
  50  |     await expect(page.locator(".message-card.assistant").getByText("OK", { exact: true })).toBeVisible();
  51  | 
  52  |     await page.locator(".message-card.assistant", { hasText: "OK" }).click();
  53  |     await expect(page.getByTestId("right-panel-title")).toHaveText("Impact");
  54  |     await expect(page.getByTestId("impact-anchor")).toContainText("message_");
  55  | 
  56  |     await page.getByTestId("nav-workflow").click();
  57  |     await expect(page.getByTestId("main-title")).toHaveText("Workflow Builder");
  58  |     await page.getByTestId("workflow-save").click();
  59  |     await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");
  60  | 
  61  |     await page.getByTestId("nav-debug").click();
  62  |     await expect(page.getByTestId("main-title")).toHaveText("Debug Inspector");
  63  |     await page.getByTestId("toggle-right-panel").click();
  64  |     await expect(page.getByTestId("right-panel")).toHaveAttribute("data-collapsed", "true");
  65  |   } finally {
  66  |     await studio.close();
  67  |     await backend.close();
  68  |   }
  69  | });
  70  | 
  71  | test("Workflow page lists saves reloads and preserves dragged node positions", async ({ page }) => {
  72  |   const backendPort = await freePort();
  73  |   const studioPort = await freePort();
  74  |   const backend = await startBackend(backendPort);
  75  |   const studio = await startStudio(studioPort, backendPort);
  76  | 
  77  |   try {
  78  |     await page.goto(`${studio.url}/workflow`);
  79  |     await expect(page.getByTestId("main-title")).toHaveText("Workflow Builder");
  80  |     await page.getByTestId("workflow-new").click();
  81  |     await page.getByTestId("workflow-name").fill("My Workflow A");
  82  |     await page.getByRole("button", { name: "agent", exact: true }).click();
  83  |     await page.getByRole("button", { name: "tool", exact: true }).click();
  84  | 
  85  |     const node = page.locator(".graph-node", { hasText: "agent" }).first();
  86  |     const otherNode = page.locator(".graph-node", { hasText: "tool" }).first();
  87  |     const before = await node.boundingBox();
  88  |     const otherBefore = await otherNode.boundingBox();
  89  |     await node.hover();
  90  |     await page.mouse.down();
  91  |     await page.mouse.move((before?.x ?? 0) + 180, (before?.y ?? 0) + 90, { steps: 8 });
  92  |     await page.mouse.up();
  93  |     const after = await node.boundingBox();
  94  |     const otherAfter = await otherNode.boundingBox();
  95  | 
  96  |     expect(after?.x).toBeGreaterThan((before?.x ?? 0) + 80);
  97  |     expect(after?.y).toBeGreaterThan((before?.y ?? 0) + 40);
  98  |     expect(otherAfter?.x).toBe(otherBefore?.x);
  99  |     expect(otherAfter?.y).toBe(otherBefore?.y);
  100 | 
  101 |     await page.getByTestId("workflow-save").click();
  102 |     await expect(page.getByTestId("status-toast")).toContainText("Workflow saved");
  103 |     await expect(page.getByTestId("workflow-list")).toContainText("My Workflow A");
  104 | 
  105 |     const templates = await (await page.request.get(`${studio.url}/api/templates`)).json();
  106 |     const saved = templates.templates.find((template) => template.name === "My Workflow A");
  107 |     expect(saved).toBeTruthy();
  108 |     const loaded = await (await page.request.get(`${studio.url}/api/templates/${saved.id}`)).json();
  109 |     expect(loaded.manifest.graph.nodes[0].position.x).toBeGreaterThan(120);
  110 |     expect(loaded.manifest.graph.nodes[0].position.y).toBeGreaterThan(80);
  111 | 
  112 |     await page.reload();
  113 |     await expect(page.getByTestId("workflow-list")).toContainText("My Workflow A");
  114 |     await page.getByRole("button", { name: /My Workflow A/ }).click();
  115 |     const reopened = page.locator(".graph-node", { hasText: "agent" });
  116 |     await expect(reopened).toBeVisible();
  117 |     const reopenedBox = await reopened.boundingBox();
> 118 |     expect(reopenedBox?.x).toBeCloseTo(after?.x ?? 0, 1);
      |                            ^ TypeError: expect(received).toBeCloseTo(expected, precision)
  119 |     expect(reopenedBox?.y).toBeCloseTo(after?.y ?? 0, 1);
  120 |   } finally {
  121 |     await studio.close();
  122 |     await backend.close();
  123 |   }
  124 | });
  125 | 
  126 | test("Message edit textarea accepts user assistant and Chinese drafts", async ({ page }) => {
  127 |   const backendPort = await freePort();
  128 |   const studioPort = await freePort();
  129 |   const backend = await startBackend(backendPort);
  130 |   const studio = await startStudio(studioPort, backendPort);
  131 | 
  132 |   try {
  133 |     await page.goto(`${studio.url}/chat?sessionId=demo-session&timelineId=demo-timeline`);
  134 | 
  135 |     const userCard = page.locator(".message-card.user").first();
  136 |     const originalUserText = (await userCard.locator("p").innerText()).trim();
  137 |     await startEditing(page, userCard);
  138 |     const userEditor = page.locator("[data-message-edit-input]").first();
  139 |     await userEditor.click();
  140 |     await expect(userEditor).toBeFocused();
  141 |     await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  142 |     await page.keyboard.type("User edit middle text", { delay: 5 });
  143 |     await page.keyboard.press("ArrowLeft");
  144 |     await page.keyboard.press("ArrowLeft");
  145 |     await page.keyboard.press("Backspace");
  146 |     await expect(userEditor).toHaveValue("User edit middle txt");
  147 |     await page.getByRole("button", { name: "Cancel" }).click();
  148 |     await expect(userCard.locator("p")).toHaveText(originalUserText);
  149 | 
  150 |     await startEditing(page, userCard);
  151 |     const chineseEditor = page.locator("[data-message-edit-input]").first();
  152 |     await chineseEditor.click();
  153 |     await expect(chineseEditor).toBeFocused();
  154 |     await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  155 |     await chineseEditor.dispatchEvent("compositionstart");
  156 |     await page.keyboard.type("这是一段测试文字", { delay: 5 });
  157 |     await chineseEditor.dispatchEvent("compositionend");
  158 |     await expect(chineseEditor).toHaveValue("这是一段测试文字");
  159 |     await page.getByRole("button", { name: "Save" }).click();
  160 |     await expect(userCard.locator("p")).toHaveText("这是一段测试文字");
  161 | 
  162 |     const assistantCard = page.locator(".message-card.assistant").first();
  163 |     await startEditing(page, assistantCard);
  164 |     const assistantEditor = page.locator("[data-message-edit-input]").first();
  165 |     await assistantEditor.click();
  166 |     await expect(assistantEditor).toBeFocused();
  167 |     await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  168 |     await page.keyboard.type("Assistant edited response", { delay: 5 });
  169 |     await expect(assistantEditor).toHaveValue("Assistant edited response");
  170 |     await page.getByRole("button", { name: "Save" }).click();
  171 |     await expect(assistantCard.locator("p")).toHaveText("Assistant edited response");
  172 |   } finally {
  173 |     await studio.close();
  174 |     await backend.close();
  175 |   }
  176 | });
  177 | 
  178 | async function startBackend(port) {
  179 |   const stateDir = await mkdtemp(join(tmpdir(), "contextos-studio-app-"));
  180 |   const storagePath = join(stateDir, "runtime-state.json");
  181 |   const child = spawn("python", ["-m", "contextos.api", "--host", "127.0.0.1", "--port", String(port)], {
  182 |     cwd: repoRoot,
  183 |     env: { ...process.env, PYTHONPATH: "backend/src", CONTEXTOS_DISABLE_LLM: "1", CONTEXTOS_RUNTIME_STATE_PATH: storagePath },
  184 |     stdio: "ignore",
  185 |   });
  186 |   const url = `http://127.0.0.1:${port}`;
  187 |   await waitForServer(`${url}/health`);
  188 |   return {
  189 |     url,
  190 |     async close() {
  191 |       child.kill();
  192 |       await once(child, "exit").catch(() => {});
  193 |       await rm(stateDir, { recursive: true, force: true });
  194 |     },
  195 |   };
  196 | }
  197 | 
  198 | async function startEditing(page, card) {
  199 |   await card.hover();
  200 |   await card.locator(".message-menu-trigger").click();
  201 |   await page.getByRole("menuitem", { name: "Edit" }).click();
  202 |   await expect(card.locator("[data-message-edit-input]")).toBeVisible();
  203 | }
  204 | 
  205 | async function startStudio(port, backendPort) {
  206 |   const child = spawn(process.execPath, ["scripts/dev-server.mjs", "--real"], {
  207 |     cwd: studioRoot,
  208 |     env: {
  209 |       ...process.env,
  210 |       CONTEXTOS_STUDIO_PORT: String(port),
  211 |       CONTEXTOS_STUDIO_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
  212 |       CONTEXTOS_STUDIO_SSE_BASE_URL: `http://127.0.0.1:${backendPort}`,
  213 |     },
  214 |     stdio: "ignore",
  215 |   });
  216 |   const url = `http://127.0.0.1:${port}`;
  217 |   await waitForServer(`${url}/__contextos/config.json`);
  218 |   return {
```