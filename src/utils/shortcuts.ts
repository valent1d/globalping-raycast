/**
 * Returns the platform-specific refresh shortcut label used in empty states.
 */
export function getRefreshShortcutLabel(): string {
  return process.platform === "win32" ? "Ctrl+R" : "⌘R";
}

/**
 * Builds a short empty-state hint showing how to trigger the primary refresh action.
 */
export function getRefreshActionHint(action: string): string {
  return `Press ${getRefreshShortcutLabel()} to ${action}`;
}
