// Score the role rules against roles set by hand on this machine (role-source is not "auto").
// Usage on the daemon host: node scripts/evaluate.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PASEO_HOME, paseoCli } from "../server/local.ts";
import { classify, signalsFromLogs } from "../server/roles/classify.ts";
import { loadRules } from "../server/roles/tagger.ts";

const rules = await loadRules();
const names = new Map<string, string>(
  JSON.parse(await paseoCli(["workspace", "ls", "--json"])).map((w: any) => [
    w.workspaceId,
    w.name,
  ])
);
let total = 0;
let right = 0;
for (const dir of await readdir(join(PASEO_HOME, "agents"))) {
  for (const file of await readdir(join(PASEO_HOME, "agents", dir))) {
    if (!file.endsWith(".json")) continue;
    const rec = JSON.parse(
      await readFile(join(PASEO_HOME, "agents", dir, file), "utf8")
    );
    const labels = rec.labels || {};
    if (!labels.role || labels["role-source"] === "auto" || rec.archivedAt)
      continue;
    const v = classify(
      {
        workspace: names.get(rec.workspaceId),
        title: rec.title,
        ...signalsFromLogs(await paseoCli(["logs", rec.id])),
        scheduled: Boolean(labels["paseo.schedule-id"]),
      },
      rules
    );
    total++;
    if (v.role === labels.role) right++;
    else
      console.log(
        `MISS ${rec.id.slice(0, 7)} want=${labels.role} got=${v.role} ${JSON.stringify(v.scores)} | ${(names.get(rec.workspaceId) || rec.title || "").slice(0, 50)}`
      );
  }
}
console.log(`${right}/${total} correct`);
