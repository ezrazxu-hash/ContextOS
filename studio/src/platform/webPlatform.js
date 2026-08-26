import { assertPlatformAdapter } from "./PlatformAdapter.js";

export function createWebPlatform(options = {}) {
  const storage = options.storage ?? globalObject()?.localStorage ?? null;
  const clipboard = options.clipboard ?? globalObject()?.navigator?.clipboard ?? null;
  const opener = options.opener ?? globalObject()?.open ?? null;
  const notifier = options.notifier ?? globalObject()?.Notification ?? null;
  const filePicker = options.filePicker ?? globalObject()?.showOpenFilePicker ?? null;
  let fallbackClipboardText = "";

  return assertPlatformAdapter({
    readUiState(key) {
      const raw = storage?.getItem?.(key);
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    },
    writeUiState(key, value) {
      storage?.setItem?.(key, JSON.stringify(value));
    },
    async readClipboardText() {
      if (clipboard?.readText) {
        return clipboard.readText();
      }
      return fallbackClipboardText;
    },
    async writeClipboardText(text) {
      fallbackClipboardText = String(text);
      if (clipboard?.writeText) {
        await clipboard.writeText(fallbackClipboardText);
      }
    },
    async openExternal(url) {
      opener?.(String(url), "_blank", "noopener,noreferrer");
    },
    async selectFile() {
      if (!filePicker) {
        return null;
      }
      const handles = await filePicker();
      return handles?.[0] ?? null;
    },
    async notify(notification) {
      if (!notifier) {
        return;
      }
      new notifier(notification.title, { body: notification.body });
    },
  });
}

function globalObject() {
  return typeof globalThis === "object" ? globalThis : null;
}
