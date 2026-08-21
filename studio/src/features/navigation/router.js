import { ChatPage } from "../../pages/Chat/index.js";
import { DebugPage } from "../../pages/Debug/index.js";
import { TemplatePage } from "../../pages/Template/index.js";
import { WorkflowPage } from "../../pages/Workflow/index.js";

const routes = [
  ["/chat", ChatPage],
  ["/workflow", WorkflowPage],
  ["/template", TemplatePage],
  ["/debug", DebugPage],
];

export function createStudioRouter() {
  const routeMap = new Map(routes);

  return {
    paths() {
      return routes.map(([path]) => path);
    },
    resolve(path) {
      const page = routeMap.get(path);
      if (!page) {
        throw new Error(`Unknown Studio route: ${path}`);
      }
      return page;
    },
  };
}
