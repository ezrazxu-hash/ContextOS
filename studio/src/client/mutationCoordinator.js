import { ClientError } from "./http.js";

export function createMutationCoordinator({ revalidate = () => {}, notifyConflict = () => {} } = {}) {
  const pending = new Map();

  async function run(options) {
    const scope = String(options.scope);
    if (pending.has(scope)) {
      return pending.get(scope);
    }

    const task = executeMutation(options, { revalidate, notifyConflict }).finally(() => {
      pending.delete(scope);
    });
    pending.set(scope, task);
    return task;
  }

  return {
    run,
    contextGroup(groupId, operationName, commit, options = {}) {
      return run({
        ...options,
        scope: `context-group:${groupId}`,
        operationName,
        commit,
      });
    },
    isPending(scope) {
      return pending.has(scope);
    },
  };
}

async function executeMutation(options, services) {
  const revalidateKeys = options.revalidateKeys ?? [];

  try {
    if (options.optimistic === true && !options.dangerous) {
      options.optimisticUpdate?.();
    }
    const data = await options.commit();
    await services.revalidate(revalidateKeys);
    return { status: "succeeded", data };
  } catch (error) {
    await services.revalidate(revalidateKeys);
    if (isConflict(error)) {
      const conflict = {
        status: "conflict",
        code: error.code,
        message: error.message,
        requestId: error.requestId ?? null,
        prompt: "reload_required",
      };
      services.notifyConflict({
        ...conflict,
        scope: options.scope,
        operationName: options.operationName ?? null,
      });
      return conflict;
    }
    return {
      status: "failed",
      code: error?.code ?? "mutation.failed",
      message: error?.message ?? "Mutation failed",
      requestId: error?.requestId ?? null,
    };
  }
}

function isConflict(error) {
  return error instanceof ClientError && error.status === 409;
}
