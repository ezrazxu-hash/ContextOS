const DEFAULT_PREFERENCES = {
  left: 280,
  right: 320,
  bottom: 240,
  collapsed: {},
};
const MAIN_MIN_WIDTH = 360;
const SIDE_MIN_WIDTH = 220;
const NARROW_VIEWPORT = 900;

export function createWorkbenchLayout(platform, options = {}) {
  const layoutId = options.layoutId ?? "default";
  const viewportWidth = options.viewportWidth ?? 1280;
  const storageKey = `contextos.workbench.${layoutId}.layout`;
  let preferences = normalizePreferences(platform.readUiState(storageKey));

  function persist() {
    platform.writeUiState(storageKey, snapshotPreferences(preferences));
  }

  return {
    resizePanel(panel, size) {
      if (panel === "bottom") {
        preferences.bottom = Math.max(160, size);
      } else if (panel === "left" || panel === "right") {
        preferences[panel] = Math.max(SIDE_MIN_WIDTH, size);
      } else {
        throw new Error(`Unknown workbench panel: ${panel}`);
      }
      persist();
    },
    collapsePanel(panel) {
      if (panel !== "left" && panel !== "right" && panel !== "bottom") {
        throw new Error(`Unknown workbench panel: ${panel}`);
      }
      preferences.collapsed[panel] = true;
      persist();
    },
    resetDefault() {
      preferences = snapshotPreferences(DEFAULT_PREFERENCES);
      persist();
    },
    view() {
      const rightAsDrawer = viewportWidth < NARROW_VIEWPORT;
      const leftWidth = preferences.collapsed.left ? 0 : preferences.left;
      const rightWidth = preferences.collapsed.right || rightAsDrawer ? 0 : preferences.right;
      const mainWidth = Math.max(MAIN_MIN_WIDTH, viewportWidth - leftWidth - rightWidth);

      return {
        kind: "workbench-layout",
        storageScope: "ui-only",
        preferences: snapshotPreferences(preferences),
        panels: {
          left: {
            role: "navigation",
            width: leftWidth,
            minWidth: SIDE_MIN_WIDTH,
            collapsed: Boolean(preferences.collapsed.left),
          },
          main: {
            role: "main",
            width: mainWidth,
            minWidth: MAIN_MIN_WIDTH,
            overflowX: "hidden",
            primaryActionVisible: true,
          },
          right: {
            role: "complementary",
            mode: rightAsDrawer ? "drawer" : "panel",
            width: rightWidth,
            minWidth: SIDE_MIN_WIDTH,
            collapsed: Boolean(preferences.collapsed.right),
          },
          bottom: {
            role: "region",
            height: preferences.collapsed.bottom ? 0 : preferences.bottom,
            minHeight: 160,
            collapsed: Boolean(preferences.collapsed.bottom),
          },
        },
      };
    },
  };
}

function normalizePreferences(saved) {
  if (!saved || typeof saved !== "object") {
    return snapshotPreferences(DEFAULT_PREFERENCES);
  }
  return {
    left: Number.isFinite(saved.left) ? saved.left : DEFAULT_PREFERENCES.left,
    right: Number.isFinite(saved.right) ? saved.right : DEFAULT_PREFERENCES.right,
    bottom: Number.isFinite(saved.bottom) ? saved.bottom : DEFAULT_PREFERENCES.bottom,
    collapsed: { ...(saved.collapsed ?? {}) },
  };
}

function snapshotPreferences(preferences) {
  return {
    left: preferences.left,
    right: preferences.right,
    bottom: preferences.bottom,
    collapsed: { ...preferences.collapsed },
  };
}
