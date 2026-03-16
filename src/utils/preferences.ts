import { getPreferenceValues } from "@raycast/api";

interface ExtensionPreferences {
  probeCount?: string;
}

const DEFAULT_PROBE_COUNT = 5;

export function getProbeLimitPreference(): number {
  const { probeCount } = getPreferenceValues<ExtensionPreferences>();
  const parsed = Number.parseInt(probeCount ?? String(DEFAULT_PROBE_COUNT), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROBE_COUNT;
  }

  return parsed;
}
