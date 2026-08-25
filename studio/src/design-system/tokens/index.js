export const lightThemeTokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  size: {
    controlHeight: 36,
    iconButton: 32,
    panelMinWidth: 240,
  },
  font: {
    family: "Inter, system-ui, sans-serif",
    body: 14,
    compact: 12,
    heading: 18,
  },
  radius: {
    control: 6,
    panel: 8,
    dialog: 8,
  },
  border: {
    subtle: "1px solid #d7dce5",
    strong: "1px solid #98a2b3",
    danger: "1px solid #d92d20",
  },
  elevation: {
    panel: "0 1px 2px rgba(16, 24, 40, 0.08)",
    dialog: "0 18px 48px rgba(16, 24, 40, 0.18)",
  },
  status: {
    neutral: { intent: "neutral", text: "#344054", surface: "#f8fafc" },
    success: { intent: "success", text: "#067647", surface: "#ecfdf3" },
    warning: { intent: "warning", text: "#b54708", surface: "#fffaeb" },
    danger: { intent: "danger", text: "#b42318", surface: "#fef3f2" },
  },
  focus: {
    ringStyle: "visible",
    ring: "0 0 0 3px rgba(21, 112, 239, 0.24)",
  },
  zIndex: {
    base: 0,
    sticky: 10,
    popover: 30,
    drawer: 40,
    dialog: 50,
    toast: 60,
  },
};
