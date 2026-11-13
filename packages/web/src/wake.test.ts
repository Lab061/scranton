import { describe, expect, it } from "vitest";
import { wakeAction } from "./wake.ts";

const longAgo = 60 * 60_000;

describe("wakeAction", () => {
  it("reconnects after a long absence", () => {
    expect(
      wakeAction({ awayMs: 5 * 60_000, forced: false, sinceResetMs: longAgo })
    ).toBe("reset");
  });

  it("only pings the connections after a short absence", () => {
    expect(
      wakeAction({ awayMs: 3_000, forced: false, sinceResetMs: longAgo })
    ).toBe("verify");
  });

  it("reconnects when the sockets are known to be gone, however short the absence", () => {
    expect(wakeAction({ awayMs: 0, forced: true, sinceResetMs: longAgo })).toBe(
      "reset"
    );
  });

  it("leaves connections opened a moment ago alone when a second trigger follows", () => {
    expect(
      wakeAction({ awayMs: 5 * 60_000, forced: true, sinceResetMs: 500 })
    ).toBe("none");
  });
});
