import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PASEO_HOME } from "./local.ts";

export interface StoredAgent {
  workspaceId: string | null;
  labels: Record<string, string>;
  archivedAt: string | null;
  internal: boolean;
}

/** The daemon's stored record for one agent (labels are not printed by `paseo ls`). */
export async function readRecordLabels(
  id: string
): Promise<StoredAgent | null> {
  const root = join(PASEO_HOME, "agents");
  for (const dir of await readdir(root).catch(() => [] as string[])) {
    try {
      const rec = JSON.parse(
        await readFile(join(root, dir, id + ".json"), "utf8")
      );
      return {
        workspaceId: rec.workspaceId ?? null,
        labels: rec.labels || {},
        archivedAt: rec.archivedAt ?? null,
        internal: Boolean(rec.internal),
      };
    } catch {
      /* not in this folder */
    }
  }
  return null;
}
