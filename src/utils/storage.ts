import { LocalStorage } from "@raycast/api";

export interface Quicklink {
  id: string;
  target: string;
  type: string;
  from: string;
}

export interface LocationStat {
  location: string;
  count: number;
  lastUsed: number;
}

const QUICKLINKS_KEY = "quicklinks";
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

export async function getQuicklinks(): Promise<Quicklink[]> {
  const raw = await LocalStorage.getItem<string>(QUICKLINKS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Quicklink[];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        typeof entry.target === "string" &&
        typeof entry.type === "string" &&
        typeof entry.from === "string",
    );
  } catch {
    return [];
  }
}

export async function saveQuicklink(quicklink: Omit<Quicklink, "id">): Promise<void> {
  const normalizedQuicklink = {
    ...quicklink,
    target: quicklink.target.trim(),
    from: sanitizeLocation(quicklink.from),
  };

  const existing = await getQuicklinks();
  const alreadyExists = existing.some(
    (q) =>
      q.target === normalizedQuicklink.target &&
      q.type === normalizedQuicklink.type &&
      q.from.toLowerCase() === normalizedQuicklink.from.toLowerCase(),
  );

  if (alreadyExists) return;

  const newEntry: Quicklink = { ...normalizedQuicklink, id: Date.now().toString() };
  await LocalStorage.setItem(QUICKLINKS_KEY, JSON.stringify([...existing, newEntry]));
}

export async function removeQuicklink(id: string): Promise<void> {
  const existing = await getQuicklinks();
  const updated = existing.filter((q) => q.id !== id);
  await LocalStorage.setItem(QUICKLINKS_KEY, JSON.stringify(updated));
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
