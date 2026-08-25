import { createAsyncBoundary } from "./pageState.js";

export function createAppErrorBoundary({ navigation = [] } = {}) {
  const boundary = createAsyncBoundary({ navigation });

  return {
    render(renderFeature) {
      try {
        return { kind: "ready", content: renderFeature() };
      } catch (error) {
        return boundary.fail({
          code: "feature_error",
          message: error.message,
          requestId: null,
          status: 500,
        });
      }
    },
  };
}

export function createToastCenter() {
  const toasts = [];

  return {
    add(toast) {
      if (toast?.dangerous) {
        return { accepted: false, reason: "danger_requires_confirm_dialog" };
      }
      const nextToast = {
        id: toast.id ?? `toast-${toasts.length + 1}`,
        kind: toast.kind ?? "info",
        message: toast.message,
      };
      toasts.push(nextToast);
      return { accepted: true, toast: nextToast };
    },
    list() {
      return toasts.map((toast) => ({ ...toast }));
    },
  };
}

export function createConfirmService() {
  return {
    danger({ title, confirmLabel }) {
      return {
        kind: "danger-confirm",
        title,
        confirmLabel,
        defaultAction: null,
        handleKey(key) {
          return { confirmed: false, key };
        },
        confirm() {
          return { confirmed: true };
        },
      };
    },
  };
}

export function createRetryController({ retry }) {
  let canRetry = false;

  return {
    networkRecovered() {
      canRetry = true;
      return {
        kind: "network-recovered",
        action: { id: "retry", label: "Retry" },
      };
    },
    manualRetry() {
      if (!canRetry) {
        return { status: "idle" };
      }
      return retry();
    },
  };
}
