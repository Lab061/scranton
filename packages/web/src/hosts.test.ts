import { beforeEach, describe, expect, it, vi } from "vitest";

// The Paseo client is the boundary: each instance stands for one relay connection.
type Fake = {
  closed: boolean;
  rpc: () => Promise<unknown>;
  close: () => Promise<void>;
};
const connections: Fake[] = [];
let nextRpc: () => Promise<unknown> = async () => snapshot;
const snapshot = { agents: [{ id: "a1" }], labelColors: {}, hostname: "box" };

vi.mock("@getpaseo/client/internal/daemon-client", () => ({
  DaemonClient: class {
    closed = false;
    rpc = nextRpc;
    constructor() {
      connections.push(this as unknown as Fake);
    }
    connect() {
      return Promise.resolve();
    }
    invokePluginRpc() {
      return this.rpc();
    }
    close() {
      this.closed = true;
      return Promise.resolve();
    }
  },
}));

// An invented relay pairing link: no real server or key.
const offer = {
  v: 2,
  serverId: "srv-test",
  daemonPublicKeyB64: "dGVzdC1rZXk=",
  relay: { endpoint: "relay.example.test:443", useTls: true },
};
const LINK =
  "https://app.paseo.sh/#offer=" +
  Buffer.from(JSON.stringify(offer)).toString("base64url");

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let hosts: typeof import("./hosts.ts");

beforeEach(async () => {
  connections.length = 0;
  nextRpc = async () => snapshot;
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  vi.resetModules();
  hosts = await import("./hosts.ts");
  hosts.addMachine("desk", LINK);
});

describe("resetConnections", () => {
  it("closes the open connection so the next read opens a fresh one", async () => {
    const first = await hosts.fetchState();
    expect(first.hosts[0]).toMatchObject({ ok: true, hostname: "box" });

    hosts.resetConnections();
    expect(connections[0].closed).toBe(true);

    const second = await hosts.fetchState();
    expect(connections).toHaveLength(2);
    expect(second.hosts[0]).toMatchObject({ ok: true, hostname: "box" });
  });

  it("keeps the fresh connection when a read on the old one fails afterwards", async () => {
    const hung = deferred<unknown>();
    nextRpc = () => hung.promise;
    const stale = hosts.fetchState();
    await vi.waitFor(() => expect(connections).toHaveLength(1));

    // The tab comes back: reset and read again on a fresh connection.
    hosts.resetConnections();
    nextRpc = async () => snapshot;
    expect((await hosts.fetchState()).hosts[0].ok).toBe(true);

    // The read on the dead socket finally gives up.
    hung.reject(new Error("WebSocket closed"));
    expect((await stale).hosts[0]).toMatchObject({ ok: false });

    const after = await hosts.fetchState();
    expect(after.hosts[0].ok).toBe(true);
    expect(connections).toHaveLength(2);
    expect(connections[1].closed).toBe(false);
  });
});
