const STORAGE_KEY = "contextos.workbench.panelWidths";
const DEFAULT_WIDTHS = [24, 52, 24];

export function createResizablePanelSpike(platform) {
  const saved = platform.readUiState(STORAGE_KEY);
  let widths = Array.isArray(saved) ? saved : DEFAULT_WIDTHS;

  return {
    resize(nextWidths) {
      widths = nextWidths;
      platform.writeUiState(STORAGE_KEY, nextWidths);
    },
    widths() {
      return [...widths];
    },
  };
}
