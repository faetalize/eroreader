import type { RestoreCounts, RestoreSummary } from "../../background/backup";

// What restoring changed, naming only what it did.
export function restoredText(summary: RestoreSummary, withSettings: boolean, withCharacter = false): string {
  const parts: string[] = [];
  const counted = (counts: RestoreCounts, one: string, many: string) => {
    const changes = [counts.added ? `${counts.added} added` : "", counts.updated ? `${counts.updated} updated` : ""].filter(Boolean);
    if (changes.length) parts.push(`${counts.added + counts.updated === 1 ? one : many} ${changes.join(", ")}`);
  };
  counted(summary.galleries, "gallery", "galleries");
  counted(summary.progress, "reading progress", "reading progress");
  counted(summary.searches, "search", "searches");
  counted(summary.covers, "cover", "covers");
  if (withSettings) parts.push(withCharacter ? "settings and character restored" : "settings restored");
  return parts.length ? `Restored: ${parts.join("; ")}.` : "Nothing new: everything in this backup is already here.";
}
