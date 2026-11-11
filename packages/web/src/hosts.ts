// Machines the page reads from: one Paseo daemon per pairing link, reached end-to-end
// encrypted through Paseo's relay. Links live only in this browser's localStorage.
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseHostTarget } from "@getpaseo/protocol/host-target";
import { demoHost } from "./demo.ts";

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
  c?.client.close?.().catch(() => {});
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

const clients = new Map<
  string,
  { client: DaemonClient; ready: Promise<void> }
>();
const lastGood = new Map<string, HostState>();

async function clientFor(m: Machine) {
  let entry = clients.get(m.id);
  if (!entry) {
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
    entry = { client, ready: client.connect() };
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

async function readMachine(m: Machine): Promise<HostState> {
  try {
    const { client, ready } = await clientFor(m);
    await timeout(ready, RPC_TIMEOUT_MS, "Connecting");
    const snap = (await timeout(
      client.invokePluginRpc(PLUGIN_ID, "office.snapshot", {}),
      RPC_TIMEOUT_MS,
      "Reading the office"
    )) as Pick<HostState, "agents" | "labelColors" | "hostname">;
    const state: HostState = { ...snap, label: m.label, ok: true, error: null };
    lastGood.set(m.id, state);
    return state;
  } catch (err) {
    // Drop the client so the next poll reconnects from scratch; keep showing the last data.
    const c = clients.get(m.id);
    clients.delete(m.id);
    c?.client.close?.().catch(() => {});
    const prev = lastGood.get(m.id);
    return {
      agents: [],
      labelColors: {},
      ...prev,
      label: m.label,
      ok: false,
      error: explain(err),
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
