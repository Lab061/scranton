// Things the daemon API does not expose yet: workspace labels and their colours,
// schedule names, and the CLI used to write agent labels.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const PASEO_HOME = process.env.PASEO_HOME || join(homedir(), ".paseo");

export function findPaseo(): string {
  const candidates = [
    process.env.PASEO_CLI,
    join(homedir(), ".local", "bin", "paseo"),
    "/Applications/Paseo.app/Contents/Resources/bin/paseo",
    "/usr/local/bin/paseo",
    "/usr/bin/paseo",
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) || "paseo";
}
export const PASEO = findPaseo();

export async function paseoCli(args: string[]): Promise<string> {
  const { stdout } = await run(PASEO, args, {
    maxBuffer: 64 << 20,
    timeout: 30_000,
  });
  return stdout;
}

function cached<T>(
  ttlMs: number,
  load: () => Promise<T>,
  fallback: T
): () => Promise<T> {
  let at = 0;
  let value = fallback;
  return async () => {
    if (Date.now() - at > ttlMs) {
      try {
        value = await load();
      } catch {
        /* keep the last good value */
      }
      at = Date.now();
    }
    return value;
  };
}

/** workspaceId -> label names, and label name -> Paseo colour name. */
export const workspaceLabels = cached(
  15_000,
  async () => {
    const byWorkspace: Record<string, string[]> = {};
    const colors: Record<string, string> = {};
    try {
      for (const w of JSON.parse(
        await readFile(join(PASEO_HOME, "projects", "workspaces.json"), "utf8")
      ))
        if (w.labels?.length) byWorkspace[w.workspaceId] = w.labels;
    } catch {
      /* older daemons keep workspaces in sqlite; labels are simply absent there */
    }
    try {
      for (const l of JSON.parse(
        await readFile(
          join(PASEO_HOME, "projects", "workspace-labels.json"),
          "utf8"
        )
      ))
        colors[l.name] = l.color;
    } catch {
      /* no labels defined */
    }
    return { byWorkspace, colors };
  },
  {
    byWorkspace: {} as Record<string, string[]>,
    colors: {} as Record<string, string>,
  }
);

/** scheduleId -> schedule name. */
export const scheduleNames = cached(
  60_000,
  async () => {
    const out: Record<string, string> = {};
    for (const s of JSON.parse(await paseoCli(["schedule", "ls", "--json"])))
      out[s.id] = s.name;
    return out;
  },
  {} as Record<string, string>
);
