import { hostname } from "node:os";
import { claudeSubagents } from "./subagents.ts";
import { scheduleNames, workspaceLabels } from "./local.ts";

export const PLUGIN_VERSION = "0.1.0";
const NEEDS_INPUT = new Set(["permission", "needs_input", "error"]);

function classifyState(
  status: string,
  reason: string | null,
  pending: unknown[],
  workspaceStatus: string | null
): string {
  if (
    pending.length ||
    (reason && NEEDS_INPUT.has(reason)) ||
    status === "error"
  )
    return "needs_input";
  if (status === "running" || status === "initializing") return "working";
  // Paseo's sidebar calls this "Ready to review": finished and not looked at yet.
  if (reason === "finished" || workspaceStatus === "attention") return "review";
  if (status === "closed") return "asleep";
  return "idle";
}

export async function snapshot(paseo: any) {
  const list = await paseo.agents.list();
  const [labels, schedules] = await Promise.all([
    workspaceLabels(),
    scheduleNames(),
  ]);
  const wsStatus = new Map<string, string>();
  try {
    for (const w of (await paseo.workspaces.list()).entries || [])
      wsStatus.set(w.id, w.status);
  } catch {
    /* older daemons: fall back to the attention flag alone */
  }
  const agents: Record<string, unknown>[] = [];
  for (const entry of list.entries || []) {
    const a = entry.agent || entry;
    if (a.archivedAt || a.internal) continue;
    const raw: Record<string, string> = a.labels || {};
    const reason = a.requiresAttention ? (a.attentionReason ?? null) : null;
    const pending = (a.pendingPermissions || []).map((p: any) => ({
      id: p.id,
      kind: p.kind,
      toolName: p.toolName || p.name,
      title: p.title || p.question,
      description: p.description,
    }));
    const sessionId = a.runtimeInfo?.sessionId || a.persistence?.sessionId;
    agents.push({
      id: a.id,
      shortId: String(a.id).slice(0, 7),
      name: (a.title || "untitled").trim(),
      status: a.status,
      state: classifyState(
        a.status,
        reason,
        pending,
        wsStatus.get(a.workspaceId) ?? null
      ),
      workspaceStatus: wsStatus.get(a.workspaceId) ?? null,
      attentionReason: reason,
      pending,
      provider: a.model ? `${a.provider}/${a.model}` : a.provider,
      cwd: a.cwd,
      project: entry.project?.projectName || null,
      workspaceId: a.workspaceId || null,
      workspace: entry.project?.workspaceName || "",
      workspaceLabels: labels.byWorkspace[a.workspaceId] || [],
      labels: Object.fromEntries(
        Object.entries(raw).filter(([k]) => !k.startsWith("paseo."))
      ),
      parentId: raw["paseo.parent-agent-id"] || null,
      scheduleId: raw["paseo.schedule-id"] || null,
      scheduleName: schedules[raw["paseo.schedule-id"]] || null,
      createdAt: a.createdAt,
      lastActivityAt: a.updatedAt,
      lastUserMessageAt: a.lastUserMessageAt,
      subagents:
        a.provider === "claude" && a.status !== "closed"
          ? await claudeSubagents(a.cwd, sessionId)
          : [],
    });
  }
  return {
    hostname: hostname(),
    collectedAt: Date.now(),
    pluginVersion: PLUGIN_VERSION,
    agents,
    labelColors: labels.colors,
  };
}
