// Memory for the current browser session, in storage.session: which galleries were finished
// (for a character's finished_count lines) and which lines were shown recently, so they
// don't repeat across galleries.

export interface SessionArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

// Used when storage.session isn't available: lost whenever the background stops.
export function memoryArea(): SessionArea {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys) => Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])),
    set: async (items) => void Object.assign(data, items),
  };
}

export async function finishInSession(area: SessionArea, gid: number): Promise<number> {
  const { finished } = await area.get(["finished"]);
  const set = new Set(Array.isArray(finished) ? finished.filter((g): g is number => typeof g === "number") : []);
  set.add(gid);
  await area.set({ finished: [...set] });
  return set.size;
}

export async function recentLines(area: SessionArea): Promise<Record<string, string[]>> {
  const { recent } = await area.get(["recent"]);
  if (typeof recent !== "object" || recent === null) return {};
  const out: Record<string, string[]> = {};
  for (const [pool, lines] of Object.entries(recent)) {
    if (Array.isArray(lines)) out[pool] = lines.filter((line): line is string => typeof line === "string");
  }
  return out;
}

export async function saveRecentLines(area: SessionArea, recent: unknown): Promise<void> {
  await area.set({ recent: typeof recent === "object" && recent !== null ? recent : {} });
}
