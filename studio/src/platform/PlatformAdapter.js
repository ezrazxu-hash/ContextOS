export const PLATFORM_CAPABILITIES = Object.freeze([
  "uiState",
  "clipboard",
  "openExternal",
  "fileDialog",
  "notification",
]);

export function assertPlatformAdapter(platform) {
  for (const method of [
    "readUiState",
    "writeUiState",
    "readClipboardText",
    "writeClipboardText",
    "openExternal",
    "selectFile",
    "notify",
  ]) {
    if (typeof platform?.[method] !== "function") {
      throw new Error(`PlatformAdapter missing method: ${method}`);
    }
  }
  return platform;
}
