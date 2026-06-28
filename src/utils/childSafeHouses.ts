import type { ChildSafeHousePoint } from '../types';

export async function fetchChildSafeHouses(): Promise<ChildSafeHousePoint[]> {
  const res = await fetch('/api/child-safe-houses');
  if (!res.ok) {
    throw new Error('Failed to load child safe houses');
  }
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}
