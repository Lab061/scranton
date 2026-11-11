// Development helper: install, reload or call the plugin on a daemon.
//   node scripts/dev.mjs <connection> install <plugin-dir>
//   node scripts/dev.mjs <connection> enable|reload|remove|list|logs
//   node scripts/dev.mjs <connection> call <method>
// <connection> is anything `paseo --host` accepts: 127.0.0.1:6767, a pairing link, ssh://host.
import { createHostClient } from "@getpaseo/client/node";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const [conn = "127.0.0.1:6767", step = "list", arg] = process.argv.slice(2);
let cred;
try {
  cred = readFileSync(
    process.env.PASEO_HOME
      ? process.env.PASEO_HOME + "/local-credential"
      : homedir() + "/.paseo/local-credential",
    "utf8"
  ).trim();
} catch {}
const client = createHostClient(conn, {
  clientId: "scranton-dev",
  clientType: "cli",
  ...(cred && !conn.includes("#offer") && !conn.startsWith("relay:")
    ? { localCredential: () => cred }
    : {}),
});
await client.connect();
const show = (v) =>
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
if (step === "install") show(await client.installDirectoryPlugin(arg));
else if (step === "enable") show(await client.enablePlugin("scranton"));
else if (step === "reload") show(await client.reloadPlugin("scranton"));
else if (step === "remove") show(await client.removePlugin("scranton"));
else if (step === "logs")
  show((await client.getPluginLogs("scranton")).slice(-20));
else if (step === "call")
  show(await client.invokePluginRpc("scranton", arg || "office.snapshot", {}));
else
  show(
    (await client.listPlugins())
      .map((p) => `${p.id}\t${p.status}\t${p.path ?? ""}`)
      .join("\n")
  );
process.exit(0);
