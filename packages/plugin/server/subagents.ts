// Background Claude Code subagents keep working after their parent's turn ends, while
// Paseo reports the parent idle. Their transcripts are the only sign they are alive.
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_PROJECTS = join(
  process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  "projects"
);
const WINDOW_MS = 30 * 60_000; // only transcripts touched in the last 30 min
const DONE_KEEP_MS = 5 * 60_000; // keep a finished subagent visible for 5 min

export interface Subagent {
  id: string;
  description: string;
  type: string;
  active: boolean;
  lastAt: string;
}

async function tailEntries(path: string, want = 8): Promise<any[]> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    for (let chunk = 65_536; ; chunk *= 4) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      let lines = buf
        .toString("utf8")
        .split("\n")
        .filter((l) => l.trim());
      if (start > 0) lines = lines.slice(1); // first line is probably cut
      if (lines.length >= want || start === 0 || chunk >= 4 << 20) {
        const out: any[] = [];
        for (const line of lines.slice(-want)) {
          try {
            out.push(JSON.parse(line));
          } catch {
            /* partial write */
          }
        }
        return out;
      }
    }
  } finally {
    await fh.close();
  }
}

/** Done once the subagent handed its result back, or its last reply has no tool call. */
function isFinal(entries: any[]): boolean {
  const msgs = entries.filter(
    (e) => e.type === "assistant" || e.type === "user"
  );
  for (const e of msgs) {
    if (e.type !== "assistant") continue;
    for (const c of e.message?.content || []) {
      if (
        c?.type === "tool_use" &&
        String(c.name || "").startsWith("SubagentHandback")
      )
        return true;
    }
  }
  const last = msgs[msgs.length - 1];
  if (!last || last.type !== "assistant") return false;
  const content = last.message?.content || [];
  if (content.some((c: any) => c?.type === "tool_use")) return false;
  return (
    last.message?.stop_reason != null && last.message.stop_reason !== "tool_use"
  );
}

export async function claudeSubagents(
  cwd: string | null | undefined,
  sessionId: string | null | undefined
): Promise<Subagent[]> {
  if (!cwd || !sessionId) return [];
  const folder = join(
    CLAUDE_PROJECTS,
    cwd.replace(/[^A-Za-z0-9]/g, "-"),
    sessionId,
    "subagents"
  );
  let files: string[];
  try {
    files = (await readdir(folder)).filter(
      (f) => f.startsWith("agent-") && f.endsWith(".jsonl")
    );
  } catch {
    return [];
  }
  const now = Date.now();
  const out: Subagent[] = [];
  for (const file of files) {
    const path = join(folder, file);
    let mtime: number;
    try {
      mtime = (await stat(path)).mtimeMs;
    } catch {
      continue;
    }
    const age = now - mtime;
    if (age > WINDOW_MS) continue;
    let done: boolean;
    try {
      const entries = await tailEntries(path);
      done = entries.length ? isFinal(entries) : age > 120_000;
    } catch {
      continue;
    }
    if (done && age > DONE_KEEP_MS) continue;
    let meta: any = {};
    try {
      meta = JSON.parse(
        await readFile(path.replace(/\.jsonl$/, ".meta.json"), "utf8")
      );
    } catch {
      /* no meta file */
    }
    out.push({
      id: file.slice(6, -6),
      description: meta.description || "subagent",
      type: meta.agentType || "",
      active: !done,
      lastAt: new Date(mtime).toISOString(),
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 8);
}
