import { assertPlatformAdapter } from "./PlatformAdapter.js";

export function createTestPlatform(options = {}) {
  const uiState = new Map(Object.entries(options.uiState ?? {}));
  let clipboardText = options.clipboardText ?? "";
  const openedExternal = [];
  const notificationLog = [];
  const files = [...(options.files ?? [])];

  return assertPlatformAdapter({
    readUiState(key) {
      return clone(uiState.get(key) ?? null);
    },
    writeUiState(key, value) {
      uiState.set(key, clone(value));
    },
    async readClipboardText() {
      return clipboardText;
    },
    async writeClipboardText(text) {
      clipboardText = String(text);
    },
    async openExternal(url) {
      openedExternal.push(String(url));
    },
    async selectFile() {
      return files.shift() ?? null;
    },
    async notify(notification) {
      notificationLog.push({ ...notification });
    },
    openedExternalUrls() {
      return [...openedExternal];
    },
    notifications() {
      return notificationLog.map((notification) => ({ ...notification }));
    },
  });
}

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}
