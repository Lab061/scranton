import type { PluginServerContext } from "@getpaseo/plugin/server";
import { snapshotRpc } from "./shared/rpc.ts";
import { snapshot } from "./server/snapshot.ts";
import { createTagger, type AgentInfo } from "./server/roles/tagger.ts";
import { paseoCli } from "./server/local.ts";
import { readRecordLabels } from "./server/records.ts";

const BACKFILL_DELAY_MS = 20_000; // let the daemon settle before tagging existing sessions

export default function contribute(server: PluginServerContext) {
  const log = (line: string) => console.error("[scranton] " + line);
  const tagger = createTagger(log);

  server.handle(snapshotRpc, async (_input, { paseo }) => snapshot(paseo));

  /** The daemon's view of one agent, with the workspace name Paseo generated for it. */
  async function agentInfo(paseo: any, id: string): Promise<AgentInfo | null> {
    const list = await paseo.agents.list();
    const entry = (list.entries || []).find(
      (e: any) => (e.agent || e).id === id
    );
    if (!entry) return null;
    const a = entry.agent || entry;
    return {
      id: a.id,
      title: a.title,
      workspace: entry.project?.workspaceName,
      labels: a.labels,
      archivedAt: a.archivedAt,
      internal: a.internal,
    };
  }

  // After a turn the first prompt and the tools it used are the best evidence there is.
  const offTurn = server.on("agent.turn_ended", async (event, { paseo }) => {
    if (tagger.isSettled(event.agent.id)) return;
    const info = await agentInfo(paseo, event.agent.id).catch(() => null);
    if (!info) return;
    const prompt = event.timeline.find((i) => i.type === "user_message") as
      { text?: string } | undefined;
    const tools = event.timeline
      .filter((i) => i.type === "tool_call")
      .map(
        (i: any) => `${i.name} ${JSON.stringify(i.detail ?? "").slice(0, 300)}`
      )
      .join("\n");
    // This turn's prompt is the session's first only on the first look; otherwise read the log.
    const first = tagger.isFirstTry(info.id) && prompt?.text;
    await tagger.consider(info, first ? { prompt: prompt!.text, tools } : {});
  });

  // Scheduled runs are labelled with their schedule from the start.
  const offCreated = server.on("agent.created", async (event, { paseo }) => {
    const info = await agentInfo(paseo, event.agent.id).catch(() => null);
    if (info?.labels?.["paseo.schedule-id"]) await tagger.consider(info);
  });

  let stopped = false;

  // Tag sessions that predate the plugin. There is no API handle outside a hook or RPC,
  // so this pass lists agents with the CLI and reads their stored labels.
  const backfill = setTimeout(async () => {
    if (stopped) return;
    try {
      const listed = JSON.parse(await paseoCli(["ls", "--json"]));
      const names = new Map<string, string>(
        JSON.parse(await paseoCli(["workspace", "ls", "--json"])).map(
          (w: any) => [w.workspaceId, w.name]
        )
      );
      let n = 0;
      for (const item of listed) {
        if (stopped) return;
        const rec = await readRecordLabels(item.id);
        if (!rec) continue;
        const info: AgentInfo = {
          id: item.id,
          title: item.name,
          workspace: (rec.workspaceId && names.get(rec.workspaceId)) || null,
          labels: rec.labels,
          archivedAt: rec.archivedAt,
          internal: rec.internal,
        };
        if (info.labels?.role) continue;
        n++;
        await tagger.consider(info);
      }
      if (n) log(`backfill looked at ${n} untagged session(s)`);
    } catch (err) {
      log(`backfill failed: ${(err as Error).message}`);
    }
  }, BACKFILL_DELAY_MS);

  return () => {
    stopped = true;
    offTurn();
    offCreated();
    clearTimeout(backfill);
  };
}
