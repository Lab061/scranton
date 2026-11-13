// Machines the page reads from: one Paseo daemon per pairing link, reached end-to-end
// encrypted through Paseo's relay. Links live only in this browser's localStorage.
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseHostTarget } from "@getpaseo/protocol/host-target";
import { demoHost } from "./demo.ts";
import { bucket, track, trackError } from "./analytics.ts";

export const PLUGIN_ID = "scranton";
const STORE_KEY = "office.machines.v1";
const RPC_TIMEOUT_MS = 15_000;

export interface Machine {
  id: string;
  label: string;
  link: string;
}

export interface HostState {
  label: string;
  ok: boolean;
  error: string | null;
  hostname?: string;
  agents: unknown[];
  labelColors: Record<string, string>;
  [key: string]: unknown;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: machines last until the tab closes */
  }
}

let memory: Machine[] | null = null;
export function listMachines(): Machine[] {
  if (!memory) memory = read<Machine[]>(STORE_KEY, []);
  return memory;
}

/** Throws a readable message when the link is not a relay pairing link. */
export function validateLink(link: string) {
  let target: ReturnType<typeof parseHostTarget>;
  try {
    target = parseHostTarget(link.trim());
  } catch {
    throw new Error(
      "That is not a Paseo pairing link. Run `paseo pair` on the machine and copy the link it prints."
    );
  }
  const offer = (target as { offer?: { daemonPublicKeyB64?: string } }).offer;
  if (!offer?.daemonPublicKeyB64)
    throw new Error(
      "Use the pairing link (with #offer=…) so the connection can be encrypted end to end."
    );
  return target as typeof target & {
    url: string;
    offer: { daemonPublicKeyB64: string };
  };
}

export function addMachine(label: string, link: string): Machine {
  validateLink(link);
  const m: Machine = {
    id: crypto.randomUUID(),
    label: label.trim().slice(0, 24),
    link: link.trim(),
  };
  if (listMachines().some((x) => x.label === m.label))
    throw new Error(`A machine called "${m.label}" already exists.`);
  memory = [...listMachines(), m];
  write(STORE_KEY, memory);
  return m;
}

export function removeMachine(id: string) {
  memory = listMachines().filter((m) => m.id !== id);
  write(STORE_KEY, memory);
  const c = clients.get(id);
  clients.delete(id);
  if (c) dispose(c);
  lastGood.delete(id);
}

// --- connections -------------------------------------------------------------

const clientId =
  read<string>("office.clientId", "") ||
  (() => {
    const id = "scranton-" + crypto.randomUUID().slice(0, 8);
    write("office.clientId", id);
    return id;
  })();

// The Paseo client is most of the bundle; demo visitors never download it.
let clientModule: Promise<
  typeof import("@getpaseo/client/internal/daemon-client")
> | null = null;
const loadClient = () =>
  (clientModule ??= import("@getpaseo/client/internal/daemon-client"));

type Entry = { client: DaemonClient; ready: Promise<void> };
// Stored as a promise, set before the first await, so overlapping reads share one connection.
const clients = new Map<string, Promise<Entry>>();
const dispose = (entry: Promise<Entry>) =>
  entry.then(({ client }) => client.close?.()).catch(() => {});
const lastGood = new Map<string, HostState>();
// Report each machine's first connection and first failure once per page load.
const reported = new Set<string>();

function errorCategory(msg: string) {
  if (/plugin is not installed/i.test(msg)) return "plugin_missing";
  if (/timed out/i.test(msg)) return "timeout";
  if (/websocket|connect|network|closed/i.test(msg)) return "connection_failed";
  return "other";
}

function clientFor(m: Machine): Promise<Entry> {
  let entry = clients.get(m.id);
  if (!entry) {
    entry = (async () => {
      const target = validateLink(m.link);
      const { DaemonClient } = await loadClient();
      const client = new DaemonClient({
        url: target.url,
        clientId,
        clientType: "browser",
        e2ee: {
          enabled: true,
          daemonPublicKeyB64: target.offer.daemonPublicKeyB64,
        },
      });
      return { client, ready: client.connect() };
    })();
    clients.set(m.id, entry);
  }
  return entry;
}

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    ),
  ]);
}

function explain(err: unknown): string {
  const msg = String(
    (err as { userMessage?: string; message?: string })?.userMessage ||
      (err as Error)?.message ||
      err
  );
  if (/plugin is not available|unknown plugin/i.test(msg))
    return "Scranton plugin is not installed or not running on this machine";
  return msg.replace(/^Request failed:\s*/, "");
}

/**
 * Close every daemon connection so the next read opens fresh ones. Browsers (Safari above all)
 * can drop a background tab's sockets without a close event, which leaves the client looking
 * connected while every request on it hangs. Last good snapshots are kept.
 */
export function resetConnections() {
  for (const entry of clients.values()) dispose(entry);
  clients.clear();
}

/**
 * Ask each open connection to prove it is alive (a short ping); the Paseo client reconnects on
 * its own when the ping fails. Cheap enough to run on every return to the tab.
 */
export function verifyConnections() {
  for (const entry of clients.values())
    entry
      .then(({ client }) => client.ensureConnected?.({ verify: true }))
      .catch(() => {});
}

async function readMachine(m: Machine): Promise<HostState> {
  const entry = clientFor(m);
  try {
    const { client, ready } = await entry;
    await timeout(ready, RPC_TIMEOUT_MS, "Connecting");
    const snap = (await timeout(
      client.invokePluginRpc(PLUGIN_ID, "office.snapshot", {}),
      RPC_TIMEOUT_MS,
      "Reading the office"
    )) as Pick<HostState, "agents" | "labelColors" | "hostname">;
    const state: HostState = { ...snap, label: m.label, ok: true, error: null };
    lastGood.set(m.id, state);
    if (!reported.has(m.id + ":ok")) {
      reported.add(m.id + ":ok");
      track("machine_connected", {
        agents: bucket(snap.agents?.length || 0),
        plugin_version: String(
          (snap as { pluginVersion?: string }).pluginVersion || "unknown"
        ),
      });
    }
    return state;
  } catch (err) {
    // Drop the client so the next poll reconnects from scratch; keep showing the last data.
    // Only if it is still the one this read used: a reset may already have replaced it, and
    // then this failure is the page's own doing, not the machine's, so it is not reported.
    const current = clients.get(m.id) === entry;
    if (current) clients.delete(m.id);
    dispose(entry);
    const prev = lastGood.get(m.id);
    const error = explain(err);
    if (current && !reported.has(m.id + ":err")) {
      reported.add(m.id + ":err");
      const reason = errorCategory(error);
      track("machine_unreachable", { reason, had_data: Boolean(prev) });
      trackError("machine", reason);
    }
    return {
      agents: [],
      labelColors: {},
      ...prev,
      label: m.label,
      ok: false,
      error,
    };
  }
}

/** Everything the office draws: one entry per machine, or demo data when none is added. */
export async function fetchState(): Promise<{
  hosts: HostState[];
  demo: boolean;
}> {
  const machines = listMachines();
  if (!machines.length) return { hosts: [demoHost()], demo: true };
  return { hosts: await Promise.all(machines.map(readMachine)), demo: false };
}
