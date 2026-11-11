# Architecture

## Data flow

1. The page keeps a list of machines (`label` + pairing link) in `localStorage` (`packages/web/src/hosts.ts`).
2. For each machine it opens a `DaemonClient` from `@getpaseo/client` with `clientType: "browser"`: `parseHostTarget(link)` gives the relay URL and the daemon's public key, and the client encrypts end to end through Paseo's relay. The client is loaded lazily, so the demo page stays small.
3. Every 3 seconds it calls `invokePluginRpc("scranton", "office.snapshot", {})` on each machine and keeps the last good snapshot when one is unreachable.
4. `packages/web/src/office.js` turns snapshots into rooms, desks and characters.

## The snapshot

`packages/plugin/server/snapshot.ts` builds one entry per unarchived agent:

| Source                                                           | Fields                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `paseo.agents.list()`                                            | status, attention, pending permissions, labels, title, project and workspace names, Claude session id |
| `paseo.workspaces.list()`                                        | workspace status (`attention` is Paseo's "Ready to review")                                           |
| `<PASEO_HOME>/projects/workspaces.json`, `workspace-labels.json` | workspace labels and their colours (not in the API yet)                                               |
| `paseo schedule ls --json`                                       | schedule names for scheduled runs                                                                     |
| `~/.claude/projects/<cwd>/<session>/subagents/*.jsonl`           | background Claude Code subagents                                                                      |

### States

| State         | Rule                                                                                       | Where in the office                  |
| ------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| `needs_input` | pending permission, attention reason `permission`/`needs_input`/`error`, or status `error` | red carpet                           |
| `working`     | status `running` or `initializing`                                                         | a desk                               |
| `review`      | attention reason `finished` or workspace status `attention`                                | green carpet                         |
| `idle`        | anything else                                                                              | lounge                               |
| `asleep`      | status `closed`                                                                            | couch, hidden unless **Show closed** |
| `managing`    | derived in the page: idle, with active subagents or working Paseo child agents             | head of a meeting room or booth      |

### Subagents

Paseo reports a session idle once its turn ends, even while background Claude Code subagents it started keep working. The plugin reads their transcripts: a subagent is active until its transcript records a `SubagentHandback…` tool call or a final reply without a tool call. Transcripts untouched for 30 minutes are ignored; finished ones stay visible for 5 minutes.

## Roles

`packages/plugin/server/roles/` classifies a session once, after a turn ends (and at startup for older sessions), and writes `role=<name>` and `role-source=auto` with `paseo agent update`. Evidence is weighted so what the session was started for wins over tools it used later:

| Evidence                                                                                 | Points |
| ---------------------------------------------------------------------------------------- | ------ |
| strong pattern in the workspace title, agent title or first 400 characters of the prompt | 4      |
| weak pattern in the workspace title                                                      | 2      |
| weak pattern in the title or prompt                                                      | 2      |
| strong pattern in the tools used                                                         | 1      |

Ties go to the earlier rule. Custom rules from `roles.json` widen built-in roles or add new ones.

## Plugin constraints

- Paseo only loads plugin modules from `client/`, `server/` or `shared/` (plus the `index.*.ts` entry files).
- Plugins install and reload on a running daemon (`installDirectoryPlugin`, `reloadPlugin`); turning plugins on for a daemon (`pluginsEnabled`) needs one restart.
- RPC handlers get a `paseo` API handle; startup code does not, so the role backfill uses the CLI and the stored agent records.
