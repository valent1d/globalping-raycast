import { LocalStorage } from "@raycast/api";

export interface LocationStat {
  location: string;
  count: number;
  lastUsed: number;
}

const LOCATION_STATS_KEY = "locationStats";

function sanitizeLocation(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const codePoint = char.codePointAt(0) ?? 0;

      return !(
        codePoint <= 0x1f ||
        codePoint === 0x7f ||
        codePoint === 0x200b ||
        codePoint === 0x200c ||
        codePoint === 0x200d ||
        codePoint === 0x2060
      );
    })
    .join("")
    .trim();
}

export async function getLocationStats(): Promise<LocationStat[]> {
  const raw = await LocalStorage.getItem<string>(LOCATION_STATS_KEY);
  if (!raw) return [];

  let parsed: LocationStat[];

  try {
    parsed = JSON.parse(raw) as LocationStat[];
  } catch {
    return [];
  }

  const mergedByLocation = new Map<string, LocationStat>();

  for (const entry of parsed) {
    if (!entry || typeof entry.location !== "string") {
      continue;
    }

    const location = sanitizeLocation(entry.location);
    if (!location) {
      continue;
    }

    const normalizedLocation = location.toLowerCase();
    const existing = mergedByLocation.get(normalizedLocation);

    if (existing) {
      existing.count += Number(entry.count) || 0;
      existing.lastUsed = Math.max(existing.lastUsed, Number(entry.lastUsed) || 0);
      continue;
    }

    mergedByLocation.set(normalizedLocation, {
      location,
      count: Math.max(0, Number(entry.count) || 0),
      lastUsed: Math.max(0, Number(entry.lastUsed) || 0),
    });
  }

  return [...mergedByLocation.values()];
}

export async function incrementLocationStat(location: string): Promise<void> {
  const sanitizedLocation = sanitizeLocation(location);
  if (!sanitizedLocation) {
    return;
  }

  const stats = await getLocationStats();
  const existing = stats.find((s) => s.location.toLowerCase() === sanitizedLocation.toLowerCase());
  if (existing) {
    existing.location = sanitizedLocation;
    existing.count += 1;
    existing.lastUsed = Date.now();
  } else {
    stats.push({ location: sanitizedLocation, count: 1, lastUsed: Date.now() });
  }
  await LocalStorage.setItem(LOCATION_STATS_KEY, JSON.stringify(stats));
}
