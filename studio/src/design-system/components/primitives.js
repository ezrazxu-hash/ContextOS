export function createButton({ label, intent = "neutral", disabled = false } = {}) {
  return interactive({
    component: "Button",
    role: "button",
    label,
    disabled,
    intent,
    ariaLabel: intent === "danger" ? `Danger action: ${label}` : label,
    requiresTextCue: intent === "danger",
  });
}

export function createInput({ label, value = "", placeholder = "" } = {}) {
  return interactive({
    component: "Input",
    role: "textbox",
    label,
    value,
    placeholder,
    ariaLabel: label,
  });
}

export function createSelect({ label, options = [], value = null } = {}) {
  return interactive({
    component: "Select",
    role: "combobox",
    label,
    options,
    value: value ?? options[0] ?? null,
    ariaLabel: label,
  });
}

export function createTabs({ label, tabs = [], selected = null } = {}) {
  return interactive({
    component: "Tabs",
    role: "tablist",
    label,
    tabs: tabs.map((tab) => ({ label: tab, role: "tab", tabIndex: 0 })),
    selected: selected ?? tabs[0] ?? null,
    ariaLabel: label,
  });
}

export function createBadge({ label, intent = "neutral" } = {}) {
  return {
    component: "Badge",
    role: "status",
    label,
    intent,
    requiresTextCue: intent === "danger",
  };
}

export function createTooltip({ label, content } = {}) {
  return interactive({
    component: "Tooltip",
    role: "tooltip-trigger",
    label,
    content,
    ariaLabel: label,
  });
}

export function createPopover({ label } = {}) {
  return interactive({
    component: "Popover",
    role: "button",
    label,
    ariaLabel: label,
    popupRole: "dialog",
  });
}

export function createDialog({ title, description, danger = false } = {}) {
  return {
    component: "Dialog",
    role: "dialog",
    title,
    description,
    intent: danger ? "danger" : "neutral",
    ariaModal: true,
    ariaLabelledBy: "dialog-title",
    ariaDescribedBy: "dialog-description",
    closeOnEsc: true,
    focusTrap: true,
    dangerSemantics: {
      textRequired: danger,
      defaultAction: danger ? "cancel" : "primary",
    },
  };
}

export function createDrawer({ title } = {}) {
  return interactive({
    component: "Drawer",
    role: "dialog-trigger",
    title,
    ariaLabel: title,
    drawerRole: "dialog",
  });
}

export function createSkeleton({ label } = {}) {
  return { component: "Skeleton", state: "loading", label, ariaBusy: true };
}

export function createEmptyState({ title, description = "" } = {}) {
  return { component: "EmptyState", state: "empty", title, description };
}

export function createErrorState({ message, requestId = null } = {}) {
  return { component: "ErrorState", state: "error", message, requestId };
}

export function interactiveComponents(components) {
  return components.filter((component) => component.tabIndex === 0);
}

function interactive(component) {
  return {
    tabIndex: 0,
    ...component,
  };
}
