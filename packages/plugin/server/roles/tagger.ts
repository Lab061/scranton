// Gives every session a `role` label once, from its title, first prompt and the tools it used.
// A role that is already set (by hand, or by an earlier pass) is never changed.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PASEO_HOME, paseoCli } from "../local.ts";
import {
  classify,
  mergeRules,
  signalsFromLogs,
  type CustomRule,
  type Rule,
  type Signals,
} from "./classify.ts";

const ROLES_FILE = join(PASEO_HOME, "scranton", "roles.json");
const MAX_TRIES = 3;

interface RolesConfig {
  /** Set false to keep the plugin from writing role labels on this machine. Default true. */
  autoTag?: boolean;
  rules?: CustomRule[];
}

let configCache: { at: number; autoTag: boolean; rules: Rule[] } | null = null;
async function loadConfig() {
  if (configCache && Date.now() - configCache.at < 30_000) return configCache;
  let cfg: RolesConfig = {};
  try {
    cfg = JSON.parse(await readFile(ROLES_FILE, "utf8"));
  } catch {
    /* no config file: defaults */
  }
  configCache = {
    at: Date.now(),
    autoTag: cfg.autoTag !== false,
    rules: mergeRules(cfg.rules || []),
  };
  return configCache;
}
export const loadRules = async (): Promise<Rule[]> =>
  (await loadConfig()).rules;
export const autoTagEnabled = async (): Promise<boolean> =>
  (await loadConfig()).autoTag;

export interface AgentInfo {
  id: string;
  title?: string | null;
  workspace?: string | null;
  labels?: Record<string, string>;
  archivedAt?: string | null;
  internal?: boolean;
}

export function needsRole(a: AgentInfo): boolean {
  return !a.archivedAt && !a.internal && !(a.labels && a.labels.role);
}

export async function decide(a: AgentInfo, extra: Partial<Signals> = {}) {
  const fromLogs = extra.prompt
    ? { prompt: undefined, tools: "" }
    : signalsFromLogs(await paseoCli(["logs", a.id]));
  return classify(
    {
      workspace: a.workspace,
      title: a.title,
      prompt: extra.prompt ?? fromLogs.prompt,
      tools: [extra.tools, fromLogs.tools].filter(Boolean).join("\n"),
      scheduled: Boolean(a.labels && a.labels["paseo.schedule-id"]),
    },
    await loadRules()
  );
}

export async function applyRole(id: string, role: string) {
  await paseoCli([
    "agent",
    "update",
    id,
    "--label",
    `role=${role}`,
    "--label",
    "role-source=auto",
  ]);
}

export function createTagger(log: (line: string) => void) {
  const settled = new Set<string>();
  const tries = new Map<string, number>();
  const busy = new Set<string>();

  async function consider(a: AgentInfo, extra: Partial<Signals> = {}) {
    if (settled.has(a.id) || busy.has(a.id) || !(await autoTagEnabled()))
      return;
    busy.add(a.id);
    try {
      if (!needsRole(a)) return void settled.add(a.id);
      const v = await decide(a, extra);
      if (v.role) {
        await applyRole(a.id, v.role);
        settled.add(a.id);
        log(`${a.id.slice(0, 7)} -> ${v.role} ${JSON.stringify(v.scores)}`);
      } else {
        const n = (tries.get(a.id) || 0) + 1;
        tries.set(a.id, n);
        if (n >= MAX_TRIES) settled.add(a.id);
      }
    } catch (err) {
      log(`${a.id.slice(0, 7)} failed: ${(err as Error).message}`);
    } finally {
      busy.delete(a.id);
    }
  }

  return {
    consider,
    isSettled: (id: string) => settled.has(id),
    isFirstTry: (id: string) => !tries.has(id),
  };
}
