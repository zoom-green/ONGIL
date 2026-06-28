import type { ChildSafeHousePoint } from '../types';

const CACHE_KEY = 'ongil_child_safe_houses_v1';

function readCachedChildSafeHouses(): ChildSafeHousePoint[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeCachedChildSafeHouses(items: ChildSafeHousePoint[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    // Storage can be unavailable in some mobile private browsing modes.
  }
}

export async function fetchChildSafeHouses(): Promise<ChildSafeHousePoint[]> {
  const res = await fetch('/api/child-safe-houses');
  if (!res.ok) {
    const cached = readCachedChildSafeHouses();
    if (cached.length > 0) return cached;
    throw new Error('Failed to load child safe houses');
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 0) writeCachedChildSafeHouses(items);
  return items.length > 0 ? items : readCachedChildSafeHouses();
}
