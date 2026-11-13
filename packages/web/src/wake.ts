// What to do with the daemon connections when the page wakes up: the tab became visible again,
// the page came back from the back/forward cache or the network came back, or the poll loop
// noticed the computer slept. Browsers (Safari above all) can drop sockets in the meantime
// without a close event, so the client still looks connected while every request hangs.

/** Away this long, assume the sockets are gone and reconnect without asking. */
export const STALE_AFTER_MS = 20_000;
/** Triggers often arrive in pairs (bfcache restore + visible, online + visible after a wake). */
export const RESET_COOLDOWN_MS = 2_000;

export type WakeAction = "reset" | "verify" | "none";

export function wakeAction(input: {
  /** How long the page was away, by the wall clock (it keeps counting while the Mac sleeps). */
  awayMs: number;
  /** The sockets are known to be gone: bfcache restore, or the network came back. */
  forced: boolean;
  /** Time since the last reset, so a second trigger does not kill the connections just opened. */
  sinceResetMs: number;
}): WakeAction {
  if (input.sinceResetMs < RESET_COOLDOWN_MS) return "none";
  if (input.forced || input.awayMs >= STALE_AFTER_MS) return "reset";
  // A short absence: a cheap ping tells a live socket from a dead one.
  return "verify";
}
