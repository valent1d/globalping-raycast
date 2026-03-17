export function getRefreshShortcutLabel(): string {
  return process.platform === "win32" ? "Ctrl+R" : "⌘R";
}

export function getRefreshActionHint(action: string): string {
  return `Press ${getRefreshShortcutLabel()} to ${action}`;
}
