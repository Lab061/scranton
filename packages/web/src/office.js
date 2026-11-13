// The office: canvas rendering, movement and the sidebar. Data comes from ./hosts.ts.
import { fetchState, resetConnections, verifyConnections } from "./hosts.ts";
import { STALE_AFTER_MS, wakeAction } from "./wake.ts";
import { showMachineStatus } from "./machines.ts";
import { bucket, setContext, track } from "./analytics.ts";

/** Built-in role names are safe to report; custom ones may name a client or project. */
const roleForAnalytics = (role) =>
  !role ? "untagged" : ROLES[role] ? role : "custom";

const POLL_MS = 3000;
// ---------------------------------------------------------------- constants
// Main floor is 24x15 tiles; the east wing (x 24..39) holds 2 meeting rooms, a corridor and 4 booths.
const T = 16,
  W = 40,
  MAIN_H = 15,
  PW = W * T,
  WING_X = 24;
const DESK_COLS = [1, 4, 7, 10],
  DESK_ROWS = [4, 7, 10];
const ENTRANCE = { tx: 13, ty: 14 };
const SPEED = 34; // px per second
const STATE_LABEL = {
  needs_input: "Needs you",
  review: "Ready to review",
  working: "Working",
  managing: "Managing",
  idle: "Idle",
  asleep: "Closed",
};
const STATE_CLASS = {
  needs_input: "need",
  review: "review",
  working: "work",
  managing: "work",
  idle: "idle",
  asleep: "sleep",
};
const REASON_LABEL = {
  permission: "Waiting for permission",
  needs_input: "Waiting for your answer",
  error: "Errored",
  finished: "Finished — unread",
};

// Role = the agent label `role=<name>`. Known roles get fixed shirt colours; others hash to one.
const ROLES = {
  orchestrator: {
    color: "#f2c14e",
    hint: "Coordinates other agents",
    outfit: "regional manager: suit, wide tie, mug",
  },
  triage: {
    color: "#ff8c42",
    hint: "Sorts incoming tickets and requests",
    outfit: "front desk: cardigan, phone",
  },
  "pr-triage": {
    color: "#1abc9c",
    hint: "Works review comments on one PR",
    outfit: "QA: polo, lanyard badge",
  },
  "pr-review": {
    color: "#6c5ce7",
    hint: "Reviews someone else's PR",
    outfit: "QA lead: polo, badge, glasses",
  },
  build: {
    color: "#2ecc71",
    hint: "Implements a ticket or change",
    outfit: "sales: short sleeves, tie, khakis",
  },
  investigate: {
    color: "#c8a165",
    hint: "Debugs prod or answers a data question",
    outfit: "accounting: sweater vest, calculator",
  },
  ops: {
    color: "#3498db",
    hint: "Runs, deploys, migrates, maintains infra",
    outfit: "sales: blue shirt, tie, headset",
  },
  plan: {
    color: "#b18cff",
    hint: "Specs, plans, estimates, brainstorms",
    outfit: "consultant: blazer, turtleneck, notebook",
  },
  comms: {
    color: "#fdcb6e",
    hint: "Drafts or answers emails and messages",
    outfit: "HR: beige sweater, clipboard",
  },
  scheduler: {
    color: "#badc58",
    hint: "Started by a Paseo schedule (automatic)",
    outfit: "warehouse: hi-vis vest, hard hat",
  },
};

// Per-role uniforms, drawn over the base sprite. Coordinates are the 16x16 sprite box.
const UNIFORMS = {
  // Regional manager: charcoal suit, wide red tie, coffee mug.
  orchestrator: {
    shirt: "#2f3542",
    sleeve: "#262b36",
    pants: "#2f3542",
    body: (P, v) => {
      if (v === "down") {
        P(6, 8, 4, 1, "#f1f2f6");
        P(7, 8, 2, 1, "#e74c3c");
        P(7, 9, 2, 3, "#c0392b");
        P(5, 8, 1, 2, "#3d4453");
        P(10, 8, 1, 2, "#3d4453");
      } else if (v !== "up") P(v === "left" ? 5 : 9, 8, 2, 1, "#f1f2f6");
    },
    prop: (P) => {
      P(12, 9, 3, 3, "#f5f6fa");
      P(15, 10, 1, 1, "#f5f6fa");
      P(12, 9, 3, 1, "#6d4c41");
    },
  },
  // Sales floor: white short-sleeve shirt, blue tie, khakis.
  build: {
    shirt: "#f1f2f6",
    sleeve: "#dfe4ea",
    pants: "#c8b48a",
    shortSleeves: true,
    body: (P, v) => {
      if (v === "down") {
        P(7, 8, 2, 1, "#1e3a6e");
        P(7, 9, 2, 2, "#2f5f9e");
      }
    },
  },
  // Sales floor, on the phones: light blue shirt, dark tie, headset.
  ops: {
    shirt: "#a7c5eb",
    sleeve: "#93b4dd",
    pants: "#b9a77d",
    shortSleeves: true,
    body: (P, v) => {
      if (v === "down") {
        P(7, 8, 2, 1, "#1e272e");
        P(7, 9, 2, 2, "#2d3436");
      }
    },
    hat: (P, v) => {
      P(4, 0, 8, 1, "#111");
      if (v !== "right") P(3, 2, 1, 4, "#111");
      if (v !== "left") P(12, 2, 1, 4, "#111");
      if (v === "down") P(4, 6, 2, 1, "#111");
    },
  },
  // Front desk: pink cardigan over a white blouse, phone handset.
  triage: {
    shirt: "#e8a0bf",
    sleeve: "#d98cb0",
    pants: "#3d3d5c",
    body: (P, v) => {
      if (v === "down") {
        P(6, 8, 4, 4, "#f5f6fa");
        P(7, 9, 1, 1, "#d98cb0");
        P(7, 11, 1, 1, "#d98cb0");
      }
    },
    prop: (P) => {
      P(12, 3, 1, 4, "#2d3436");
      P(13, 3, 1, 1, "#2d3436");
      P(13, 6, 1, 1, "#2d3436");
    },
  },
  // Accounting: olive sweater vest over a white shirt, glasses, calculator.
  investigate: {
    shirt: "#6b7a3a",
    sleeve: "#e5e7ec",
    pants: "#57606f",
    glasses: true,
    body: (P, v) => {
      if (v === "down") {
        P(6, 8, 1, 1, "#f5f6fa");
        P(9, 8, 1, 1, "#f5f6fa");
        P(6, 9, 1, 1, "#8a9a4a");
        P(9, 10, 1, 1, "#8a9a4a");
        P(7, 10, 1, 1, "#8a9a4a");
      }
    },
    prop: (P) => {
      P(12, 9, 3, 4, "#dfe4ea");
      P(12, 9, 3, 1, "#7bed9f");
      P(12, 11, 1, 1, "#57606f");
      P(14, 11, 1, 1, "#57606f");
      P(13, 12, 1, 1, "#57606f");
    },
  },
  // HR: beige sweater, white collar, clipboard.
  comms: {
    shirt: "#d8c3a5",
    sleeve: "#c7b08e",
    pants: "#6b5b4b",
    body: (P, v) => {
      if (v === "down") P(6, 8, 4, 1, "#f5f6fa");
    },
    prop: (P) => {
      P(12, 8, 3, 5, "#8d5a3b");
      P(12, 9, 3, 3, "#ffffff");
      P(13, 8, 1, 1, "#b2bec3");
    },
  },
  // Quality assurance lead: light blue polo, lanyard and badge, glasses.
  "pr-review": {
    shirt: "#9ec5e8",
    sleeve: "#8ab4da",
    pants: "#2c3e50",
    glasses: true,
    shortSleeves: true,
    body: (P, v) => {
      if (v === "down") {
        P(6, 8, 4, 1, "#7fa6cc");
        P(5, 8, 1, 1, "#c0392b");
        P(6, 9, 1, 1, "#c0392b");
        P(10, 8, 1, 1, "#c0392b");
        P(9, 9, 1, 1, "#c0392b");
        P(7, 10, 2, 2, "#ffffff");
        P(7, 10, 2, 1, "#c0392b");
      }
    },
  },
  // Quality assurance: green polo, lanyard and badge.
  "pr-triage": {
    shirt: "#7fbf7f",
    sleeve: "#6aa86a",
    pants: "#3d4a5c",
    shortSleeves: true,
    body: (P, v) => {
      if (v === "down") {
        P(6, 8, 4, 1, "#5f9e5f");
        P(5, 8, 1, 1, "#2f5f9e");
        P(6, 9, 1, 1, "#2f5f9e");
        P(10, 8, 1, 1, "#2f5f9e");
        P(9, 9, 1, 1, "#2f5f9e");
        P(7, 10, 2, 2, "#ffffff");
        P(7, 10, 2, 1, "#2f5f9e");
      }
    },
  },
  // Consultant from corporate: grey blazer, black turtleneck, notebook.
  plan: {
    shirt: "#7f8c8d",
    sleeve: "#6c7a7b",
    pants: "#2d3436",
    body: (P, v) => {
      if (v === "down") P(6, 8, 4, 4, "#2d3436");
      if (v === "up") P(6, 8, 4, 1, "#2d3436");
    },
    prop: (P) => {
      P(12, 9, 2, 4, "#2f3640");
      P(13, 9, 1, 4, "#f5f6fa");
    },
  },
  // Warehouse: grey tee, hi-vis vest, hard hat, jeans.
  scheduler: {
    shirt: "#95a5a6",
    sleeve: "#7f8c8d",
    pants: "#3b5b92",
    shortSleeves: true,
    body: (P, v) => {
      if (v === "down") {
        P(4, 8, 3, 4, "#ff8c42");
        P(9, 8, 3, 4, "#ff8c42");
        P(4, 10, 3, 1, "#f9f871");
        P(9, 10, 3, 1, "#f9f871");
      } else {
        P(4, 8, 8, 4, "#ff8c42");
        P(4, 10, 8, 1, "#f9f871");
      }
    },
    hat: (P, v) => {
      P(4, 0, 8, 2, "#f9ca24");
      P(5, 0, 6, 1, "#ffe066");
      P(3, 2, 10, 1, "#e1b12c");
      if (v === "down") P(7, 0, 2, 1, "#fff3b0");
    },
  },
};
const UNTAGGED = "#cfd3da";
const LABEL_COLORS = {
  emerald: "#10b981",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
  gray: "#9ca3af",
  slate: "#94a3b8",
};
// An explicit role label wins; scheduled runs default to "scheduler".
function roleOf(a) {
  return (a.labels && a.labels.role) || (a.scheduleId ? "scheduler" : "");
}
function roleColor(role) {
  if (!role) return UNTAGGED;
  return ROLES[role] ? ROLES[role].color : SHIRT[hash(role) % SHIRT.length];
}
function projectName(p) {
  return String(p || "other").replace(/\s*\((vps|mac)\)\s*$/i, "");
}
function storeGet(k, d) {
  try {
    return localStorage.getItem(k) || d;
  } catch {
    return d;
  }
}
function storeSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

const SKIN = ["#f6d5bb", "#eab991", "#c98d5f", "#9b6542", "#6d452a", "#ffe2cc"];
const HAIR = [
  "#2b1d14",
  "#5b3a22",
  "#a2552c",
  "#e2b552",
  "#dadada",
  "#c33b2f",
  "#3e3e72",
  "#141414",
  "#e27fb0",
];
const SHIRT = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#9b59b6",
  "#f39c12",
  "#1abc9c",
  "#e84393",
  "#465c73",
  "#fdcb6e",
  "#6c5ce7",
  "#ff7f50",
];
const PANTS = ["#2d3436", "#34495e", "#3b3b98", "#5d4037", "#4a4a4a"];

// ---------------------------------------------------------------- helpers
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => c(v).toString(16).padStart(2, "0"))
      .join("")
  );
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]
  );
}
function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}
function base(p) {
  return (p || "").replace(/\/+$/, "").split("/").pop() || p || "";
}
function tileFoot(tx, ty) {
  return { x: tx * T + 8, y: ty * T + 14 };
}

function makeLook(id) {
  const r = rng(hash(id));
  return {
    skin: pick(r, SKIN),
    hair: pick(r, HAIR),
    shirt: pick(r, SHIRT),
    pants: pick(r, PANTS),
    style: Math.floor(r() * 4),
    acc: pick(r, ["none", "none", "glasses", "headphones", "cap"]),
    accColor: pick(r, SHIRT),
    phase: r() * 10,
  };
}

// ---------------------------------------------------------------- glyphs
const GLYPH = {
  "*": ["..#..", ".###.", "#####", ".###.", ".#.#."],
  "!": ["..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "...#.", "..##.", ".....", "..#.."],
  x: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  v: ["....#", "...#.", "#.#..", ".#...", "....."],
  z: ["####.", "..#..", ".#...", "####.", "....."],
  n: ["..##.", "..#.#", "..#..", "##...", "##..."],
  ".": [".....", ".....", ".....", "#.#.#", "....."],
};

// ---------------------------------------------------------------- room model
// Meeting room i (0..1): 8x7 tiles under the back wall, door at the bottom right.
function meetingGeom(i) {
  const x0 = WING_X + i * 8,
    seats = [];
  for (let k = 0; k < 4; k++) {
    const tx = x0 + 2 + k;
    seats.push({
      kind: "tseat",
      side: "bottom",
      tx,
      ty: 7,
      x: tx * T + 8,
      y: 7 * T + 13,
    });
    seats.push({
      kind: "tseat",
      side: "top",
      tx,
      ty: 4,
      x: tx * T + 8,
      y: 5 * T + 6,
    });
  }
  const overflow = [];
  for (let tx = x0 + 1; tx <= x0 + 7; tx++)
    overflow.push({ kind: "floor", tx, ty: 8, ...tileFoot(tx, 8) });
  return {
    kind: "meeting",
    cap: 8,
    x0,
    inner: { x: x0 + 1, y: 3, w: 7, h: 6 },
    seats,
    overflow,
    table: { x: (x0 + 2) * T - 3, y: 5 * T + 1, w: 4 * T + 6, h: 2 * T - 3 },
    head: {
      kind: "head",
      tx: x0 + 6,
      ty: 5,
      x: (x0 + 6) * T + 8,
      y: 6 * T + 2,
    },
    plate: { x: x0 * T + 20, y: 26, w: 100 },
  };
}
// Booth j (0..3): 4x4 tiles below the corridor, for a manager with one or two helpers.
function boothGeom(j) {
  const x0 = WING_X + j * 4;
  return {
    kind: "booth",
    cap: 2,
    x0,
    inner: { x: x0 + 1, y: 12, w: 3, h: 3 },
    seats: [
      {
        kind: "tseat",
        side: "top",
        tx: x0 + 2,
        ty: 12,
        x: (x0 + 2) * T + 8,
        y: 13 * T + 6,
      },
      {
        kind: "tseat",
        side: "bottom",
        tx: x0 + 1,
        ty: 14,
        x: (x0 + 1) * T + 8,
        y: 14 * T + 13,
      },
    ],
    overflow: [
      { kind: "floor", tx: x0 + 1, ty: 12, ...tileFoot(x0 + 1, 12) },
      { kind: "floor", tx: x0 + 3, ty: 14, ...tileFoot(x0 + 3, 14) },
    ],
    table: { x: (x0 + 1) * T - 1, y: 13 * T + 1, w: 2 * T + 2, h: T - 2 },
    head: {
      kind: "head",
      tx: x0 + 3,
      ty: 13,
      x: (x0 + 3) * T + 8,
      y: 13 * T + 13,
    },
    plate: { x: x0 * T + 18, y: 11 * T + 3, w: 44 },
  };
}

function buildRoom(label) {
  const H = MAIN_H;
  const walk = new Uint8Array(W * H).fill(1);
  const block = (x, y) => {
    if (x >= 0 && y >= 0 && x < W && y < H) walk[y * W + x] = 0;
  };
  for (let y = 0; y < 3; y++) for (let x = 0; x < W; x++) block(x, y);
  const seats = [];
  for (const dy of DESK_ROWS)
    for (const dx of DESK_COLS) {
      block(dx, dy);
      block(dx + 1, dy);
      seats.push({
        kind: "seat",
        tx: dx,
        ty: dy + 1,
        x: dx * T + 16,
        y: (dy + 1) * T + 13,
        dx,
        dy,
      });
    }
  [
    [13, 3],
    [13, 4],
    [13, 7],
    [13, 8],
    [13, 10],
  ].forEach(([x, y]) => block(x, y)); // divider plants
  for (let x = 15; x <= 18; x++) {
    block(x, 3);
    block(x, 4);
  } // couch
  for (let x = 21; x <= 23; x++) block(x, 3); // coffee counter
  block(18, 7);
  block(19, 7); // coffee table
  block(22, 7);
  block(22, 9); // beanbags
  block(23, 9); // plant (23,10 is the way east)
  block(14, 11); // help sign
  block(12, 3); // copier
  block(14, 3); // water cooler
  block(0, 13); // paper boxes
  block(0, 14);
  const slots = [
    meetingGeom(0),
    meetingGeom(1),
    boothGeom(0),
    boothGeom(1),
    boothGeom(2),
    boothGeom(3),
  ];
  slots.forEach((sl, i) => (sl.i = i));
  for (const sl of slots.filter((x) => x.kind === "meeting")) {
    const x0 = sl.x0;
    for (let y = 3; y <= 9; y++) block(x0, y); // left wall
    for (let x = x0; x <= x0 + 5; x++) block(x, 9); // bottom wall, door at x0+6..7
    for (let x = x0 + 2; x <= x0 + 5; x++) {
      block(x, 5);
      block(x, 6);
    } // table
    block(x0 + 7, 5);
    block(x0 + 7, 6); // whiteboard
    block(x0 + 1, 3); // plant
    block(x0 + 1, 6); // TV on a cart
  }
  for (const sl of slots.filter((x) => x.kind === "booth")) {
    const x0 = sl.x0;
    for (let y = 11; y <= 14; y++) block(x0, y); // left wall
    block(x0 + 1, 11);
    block(x0 + 2, 11); // glass front, door at x0+3
    block(x0 + 1, 13);
    block(x0 + 2, 13); // table
  }
  const ok = (x, y) => walk[y * W + x] === 1;

  const workOverflow = [];
  for (const y of [6, 9, 3])
    for (let x = 0; x <= 12; x++)
      if (ok(x, y))
        workOverflow.push({ kind: "floor", tx: x, ty: y, ...tileFoot(x, y) });
  // "Ready to review": finished sessions wait on a carpet at the front of the main floor.
  const review = [];
  for (const y of [13, 12, 14])
    for (let x = 1; x <= 11; x++)
      if (ok(x, y))
        review.push({ kind: "floor", tx: x, ty: y, ...tileFoot(x, y) });
  const help = [];
  for (const y of [12, 13, 11, 14])
    for (let x = 15; x <= 22; x++)
      if (ok(x, y))
        help.push({ kind: "floor", tx: x, ty: y, ...tileFoot(x, y) });
  const nap = [];
  for (let x = 15; x <= 18; x++)
    nap.push({ kind: "couch", tx: x, ty: 4, x: x * T + 8, y: 4 * T + 13 });
  nap.push(
    { kind: "bean", tx: 22, ty: 7, x: 22 * T + 8, y: 7 * T + 13 },
    { kind: "bean", tx: 22, ty: 9, x: 22 * T + 8, y: 9 * T + 13 }
  );
  for (const y of [10, 9])
    for (let x = 14; x <= 23; x++)
      if (ok(x, y))
        nap.push({ kind: "floor", tx: x, ty: y, ...tileFoot(x, y) });
  for (const y of [3])
    for (let x = 0; x <= 12; x++)
      if (ok(x, y))
        nap.push({ kind: "floor", tx: x, ty: y, ...tileFoot(x, y) });

  const room = {
    label,
    walk,
    seats,
    workOverflow,
    help,
    nap,
    review,
    slots,
    H,
    PH: H * T,
    ents: new Map(),
    host: null,
    bg: null,
    teamSlots: new Map(),
  };
  room.bg = paintRoom(room);
  return room;
}

function lounge(room) {
  const napTaken = new Set();
  for (const e of room.ents.values())
    if (e.spot && e.spot.pool === "nap")
      napTaken.add(e.spot.tx + "," + e.spot.ty);
  const tiles = [];
  for (let y = 4; y <= 10; y++)
    for (let x = 14; x <= 23; x++)
      if (room.walk[y * W + x] && !napTaken.has(x + "," + y))
        tiles.push({ tx: x, ty: y });
  return tiles;
}

function bfs(room, from, to) {
  const H = room.H,
    key = (x, y) => y * W + x;
  const prev = new Int32Array(W * H).fill(-1);
  const start = key(from.tx, from.ty),
    goal = key(to.tx, to.ty);
  if (start === goal) return [];
  const q = [start];
  prev[start] = start;
  while (q.length) {
    const cur = q.shift();
    if (cur === goal) break;
    const cx = cur % W,
      cy = (cur / W) | 0;
    for (const [nx, ny] of [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = key(nx, ny);
      if (prev[k] !== -1) continue;
      if (!room.walk[k] && k !== goal) continue;
      prev[k] = cur;
      q.push(k);
    }
  }
  if (prev[goal] === -1) return null;
  const path = [];
  for (let k = goal; k !== start; k = prev[k])
    path.push({ tx: k % W, ty: (k / W) | 0 });
  return path.reverse();
}

// ---------------------------------------------------------------- static painting (1x)
function paintRoom(room) {
  const c = document.createElement("canvas");
  c.width = PW;
  c.height = room.PH;
  const g = c.getContext("2d");
  const R = (x, y, w, h, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  // wood floor
  for (let ty = 3; ty < MAIN_H; ty++)
    for (let tx = 0; tx < W; tx++) {
      const alt = (ty + (tx >> 1)) % 2;
      R(tx * T, ty * T, T, T, alt ? "#b48457" : "#a97a4f");
      R(tx * T, ty * T + 15, T, 1, "#8a5f3a");
      if ((tx + ty) % 3 === 0) R(tx * T + 7, ty * T, 1, 15, "#946743");
    }
  // lounge carpet
  R(14 * T, 3 * T, 10 * T, 8 * T, "#3d6f73");
  for (let y = 3 * T; y < 11 * T; y += 4)
    for (let x = 14 * T + ((y / 4) % 2) * 2; x < W * T; x += 4)
      R(x, y, 1, 1, "#467c80");
  // rug
  R(16 * T - 4, 6 * T - 2, 6 * T + 8, 4 * T + 4, "#c96d4f");
  R(16 * T - 2, 6 * T, 6 * T + 4, 4 * T, "#e0916b");
  for (let x = 16 * T; x < 22 * T; x += 6)
    (R(x, 6 * T + 2, 3, 2, "#c96d4f"), R(x, 10 * T - 4, 3, 2, "#c96d4f"));
  // help carpet
  R(15 * T - 2, 11 * T + 2, 8 * T + 4, 4 * T - 2, "#e0b04a");
  R(15 * T, 11 * T + 4, 8 * T, 4 * T - 6, "#a83246");
  for (let x = 15 * T + 3; x < 23 * T; x += 8)
    (R(x, 11 * T + 6, 2, 2, "#c4485c"), R(x + 4, 15 * T - 6, 2, 2, "#c4485c"));
  // entrance mat
  R(ENTRANCE.tx * T + 1, ENTRANCE.ty * T + 6, 14, 9, "#5b4a3a");
  R(ENTRANCE.tx * T + 3, ENTRANCE.ty * T + 8, 10, 5, "#776250");
  // ready-to-review carpet
  R(T - 2, 12 * T + 2, 11 * T + 4, 3 * T - 2, "#e0b04a");
  R(T, 12 * T + 4, 11 * T, 3 * T - 6, "#2f7d55");
  for (let x = T + 3; x < 12 * T; x += 8)
    (R(x, 12 * T + 6, 2, 2, "#3f9a6b"), R(x + 4, 15 * T - 6, 2, 2, "#3f9a6b"));
  // wall
  R(0, 0, PW, 48, "#4a4e69");
  for (let x = 0; x < PW; x += 8) R(x, 4, 1, 40, "#454962");
  R(0, 0, PW, 4, "#22223b");
  R(0, 42, PW, 6, "#2b2d42");
  R(0, 42, PW, 1, "#5c6080");
  R(13 * T + 6, 0, 4, 48, "#2b2d42");
  // cork board
  R(176, 10, 26, 20, "#6b4a2b");
  R(178, 12, 22, 16, "#c49a5d");
  R(181, 14, 6, 5, "#fff59d");
  R(189, 15, 7, 5, "#90caf9");
  R(184, 21, 6, 5, "#f48fb1");
  R(193, 22, 4, 4, "#a5d6a7");
  // bookshelf
  R(230, 6, 32, 41, "#5d4037");
  R(232, 8, 28, 37, "#3e2723");
  const books = [
    "#e57373",
    "#64b5f6",
    "#81c784",
    "#ffd54f",
    "#ba68c8",
    "#4db6ac",
    "#ff8a65",
  ];
  for (let s = 0; s < 3; s++) {
    R(232, 19 + s * 12, 28, 2, "#5d4037");
    for (let b = 0; b < 7; b++)
      R(233 + b * 4, 10 + s * 12, 3, 9 - (b % 3), books[(b + s * 2) % 7]);
  }
  // plaque frame
  R(272, 9, 68, 18, "#2b2d42");
  R(273, 10, 66, 16, "#3a2f2a");
  // desks + monitors
  for (const s of room.seats) {
    const x = s.dx * T,
      y = s.dy * T;
    R(x + 1, y + 13, 2, 3, "#4e342e");
    R(x + 29, y + 13, 2, 3, "#4e342e");
    R(x, y + 2, 32, 12, "#8d6e63");
    R(x, y + 2, 32, 2, "#a1887f");
    R(x, y + 12, 32, 2, "#6d4c41");
    R(x + 9, y - 7, 14, 11, "#2d3436");
    R(x + 15, y + 4, 2, 2, "#2d3436");
    R(x + 12, y + 5, 8, 1, "#2d3436");
    R(x + 10, y + 8, 12, 3, "#cfd8dc");
    R(x + 10, y + 10, 12, 1, "#90a4ae");
    const r = rng(hash(room.label + s.dx + "," + s.dy));
    if (r() < 0.6) {
      R(x + 25, y + 6, 4, 4, pick(r, ["#ffffff", "#ffcc80", "#80deea"]));
      R(x + 29, y + 7, 1, 2, "#ffffff");
    }
    if (r() < 0.4) {
      R(x + 2, y + 5, 6, 5, "#fff59d");
      R(x + 3, y + 6, 4, 1, "#c0b060");
    }
  }
  // plants
  const plant = (px, py) => {
    R(px + 4, py + 9, 8, 6, "#8d5a3b");
    R(px + 4, py + 9, 8, 1, "#a66d48");
    R(px + 2, py + 2, 12, 8, "#2e7d32");
    R(px + 4, py, 8, 3, "#388e3c");
    R(px + 1, py + 5, 3, 3, "#43a047");
    R(px + 12, py + 4, 3, 3, "#43a047");
    R(px + 6, py + 3, 2, 2, "#66bb6a");
  };
  [
    [13, 3],
    [13, 4],
    [13, 7],
    [13, 8],
    [13, 10],
    [23, 9],
  ].forEach(([x, y]) => plant(x * T, y * T));
  // couch
  R(15 * T - 2, 3 * T + 4, 4 * T + 4, 10, "#5e35b1");
  R(15 * T - 2, 3 * T + 14, 4 * T + 4, 12, "#7e57c2");
  R(15 * T - 4, 3 * T + 8, 4, 18, "#5e35b1");
  R(19 * T, 3 * T + 8, 4, 18, "#5e35b1");
  for (let i = 1; i < 4; i++)
    R(15 * T + i * T - 1, 3 * T + 15, 1, 10, "#673ab7");
  // coffee counter
  R(21 * T, 3 * T, 3 * T, 14, "#795548");
  R(21 * T, 3 * T, 3 * T, 3, "#a1887f");
  R(21 * T, 3 * T + 12, 3 * T, 2, "#5d4037");
  R(21 * T + 4, 3 * T - 10, 12, 14, "#37474f");
  R(21 * T + 6, 3 * T - 8, 8, 4, "#90a4ae");
  R(21 * T + 8, 3 * T, 4, 2, "#eceff1");
  R(21 * T + 13, 3 * T - 6, 1, 1, "#ff5252");
  R(22 * T + 6, 3 * T + 4, 3, 4, "#ffffff");
  R(22 * T + 11, 3 * T + 4, 3, 4, "#ffcc80");
  R(23 * T + 4, 3 * T - 4, 8, 8, "#e0e0e0");
  R(23 * T + 5, 3 * T - 3, 6, 2, "#8d6e63");
  // coffee table
  R(18 * T + 2, 7 * T + 4, 28, 10, "#6d4c41");
  R(18 * T + 2, 7 * T + 4, 28, 2, "#8d6e63");
  R(18 * T + 6, 7 * T + 6, 4, 3, "#ffffff");
  R(18 * T + 18, 7 * T + 5, 7, 5, "#4fc3f7");
  // beanbags
  for (const by of [7, 9]) {
    R(22 * T + 1, by * T + 4, 14, 11, "#ef6c00");
    R(22 * T + 3, by * T + 2, 10, 4, "#fb8c00");
    R(22 * T + 4, by * T + 6, 8, 6, "#ffa726");
  }
  // help sign
  R(14 * T + 7, 11 * T + 6, 2, 10, "#5d4037");
  R(14 * T + 1, 11 * T - 4, 14, 11, "#fff3e0");
  R(14 * T + 1, 11 * T - 4, 14, 1, "#e0b04a");
  R(14 * T + 7, 11 * T - 2, 2, 5, "#d32f2f");
  R(14 * T + 7, 11 * T + 4, 2, 2, "#d32f2f");
  // paper-company details: copier, water cooler, boxes of copy paper
  {
    const X = 12 * T,
      Y = 3 * T;
    R(X + 1, Y + 2, 14, 13, "#b2bec3");
    R(X + 1, Y + 2, 14, 3, "#dfe6e9");
    R(X + 3, Y + 6, 10, 2, "#ffffff");
    R(X + 3, Y + 10, 10, 3, "#95a5a6");
    R(X + 12, Y + 3, 1, 1, "#2ecc71");
  }
  {
    const X = 14 * T,
      Y = 3 * T;
    R(X + 4, Y + 7, 8, 8, "#dfe6e9");
    R(X + 4, Y + 14, 8, 1, "#b2bec3");
    R(X + 5, Y - 1, 6, 8, "#74b9ff");
    R(X + 6, Y, 1, 6, "#a6d4ff");
    R(X + 5, Y + 9, 2, 2, "#ff7675");
    R(X + 9, Y + 9, 2, 2, "#0984e3");
  }
  for (const [ty, w] of [
    [13, 14],
    [14, 13],
  ]) {
    const X = 1,
      Y = ty * T + 2;
    R(X, Y, w, 12, "#c8a165");
    R(X, Y, w, 2, "#d9b77a");
    R(X + 5, Y, 3, 12, "#b08a50");
    R(X + 2, Y + 5, 4, 3, "#f5f6fa");
  }
  // east wing: meeting rooms, corridor, booths
  R(WING_X * T, 3 * T, (W - WING_X) * T, 12 * T, "#a97a4f");
  for (let tx = WING_X; tx < W; tx++) {
    R(tx * T, 10 * T, T, T, tx % 2 ? "#b48457" : "#a97a4f");
    R(tx * T, 10 * T + 15, T, 1, "#8a5f3a");
  }
  R(WING_X * T, 10 * T + 3, (W - WING_X) * T, 10, "#6a4f6e");
  for (let x = WING_X * T; x < W * T; x += 8)
    R(x + 2, 10 * T + 7, 4, 2, "#7d6382");
  for (const sl of room.slots) {
    const X = sl.x0 * T,
      I = sl.inner;
    R(I.x * T, I.y * T, I.w * T, I.h * T, "#454b63");
    for (let y = I.y * T; y < (I.y + I.h) * T; y += 4)
      for (let x = I.x * T + ((y / 4) % 2) * 2; x < (I.x + I.w) * T; x += 4)
        R(x, y, 1, 1, "#4d5470");
    if (sl.kind === "meeting") {
      R(X, 3 * T, T, 7 * T, "#3d4060");
      R(X + 12, 3 * T, 4, 7 * T, "#5c6080");
      R(X + 2, 3 * T, 8, 7 * T - 3, "#34375a");
      R(X, 9 * T, 6 * T, T, "#3d4060");
      R(X, 9 * T, 6 * T, 3, "#5c6080");
      R(X, 9 * T + 14, 6 * T, 2, "#2b2d42");
      for (let tx = 1; tx < 6; tx++) {
        R(X + tx * T + 1, 9 * T + 5, 14, 7, "#7fa8c9");
        R(X + tx * T + 2, 9 * T + 6, 3, 1, "#c4dff2");
      }
      R(X + 6 * T, 9 * T, 2, T, "#2b2d42");
      const B = (sl.x0 + 7) * T;
      R(B + 1, 5 * T - 6, 14, 26, "#95a5a6");
      R(B + 2, 5 * T - 5, 12, 24, "#f5f6fa");
      R(B + 4, 5 * T - 2, 7, 1, "#3498db");
      R(B + 4, 5 * T + 2, 5, 1, "#e74c3c");
      R(B + 4, 5 * T + 6, 8, 1, "#2ecc71");
      R(B + 4, 5 * T + 10, 3, 3, "#f39c12");
      R(B + 9, 5 * T + 10, 3, 3, "#9b59b6");
      R(B + 3, 7 * T - 10, 1, 8, "#636e72");
      R(B + 12, 7 * T - 10, 1, 8, "#636e72");
      const PX = X + T,
        PY = 3 * T;
      R(PX + 4, PY + 9, 8, 6, "#8d5a3b");
      R(PX + 2, PY + 2, 12, 8, "#2e7d32");
      R(PX + 4, PY, 8, 3, "#43a047");
      // TV on a cart
      const TX = X + T,
        TY = 6 * T;
      R(TX + 3, TY + 10, 1, 5, "#636e72");
      R(TX + 12, TY + 10, 1, 5, "#636e72");
      R(TX + 2, TY + 9, 12, 2, "#7f8c8d");
      R(TX + 1, TY - 1, 14, 10, "#2d3436");
      R(TX + 2, TY, 12, 8, "#3a4a6b");
      R(TX + 3, TY + 1, 4, 1, "#5f7aa8");
      R(sl.plate.x - 2, sl.plate.y - 2, sl.plate.w + 4, 14, "#2b2d42");
    } else {
      R(X, 11 * T, T / 2, 4 * T, "#3d4060");
      R(X + 6, 11 * T, 2, 4 * T, "#5c6080");
      R(X + T / 2, 11 * T, 3 * T - T / 2, T, "#3d4060");
      R(X + T / 2, 11 * T, 3 * T - T / 2, 2, "#5c6080");
      R(X + T + 1, 11 * T + 4, 2 * T - 2, 8, "#7fa8c9");
      R(X + T / 2, 12 * T, T / 2, 3 * T, "#6c5ce7");
      for (let y = 12 * T; y < 15 * T; y += 4)
        R(X + T / 2 + 2, y + 1, 4, 2, "#5b4bd0"); // acoustic foam
      R(X + 4 * T - 1, 11 * T, 1, T, "#2b2d42");
    }
  }
  return c;
}

// ---------------------------------------------------------------- character sprite
function drawChar(P, look, o) {
  // P(x, y, w, h, color) is relative to the sprite's 16x16 box; o = {view, frame, pose, blink}
  const U = UNIFORMS[look.role] || null;
  const { skin, hair, style, accColor } = look;
  const shirt = U ? U.shirt : look.shirt,
    pants = U && U.pants ? U.pants : look.pants;
  // A uniform hat replaces random caps/headphones; glasses survive under any hat.
  const acc =
    U && U.glasses
      ? "glasses"
      : U && U.hat
        ? look.acc === "glasses"
          ? "glasses"
          : "none"
        : look.acc;
  const skinD = shade(skin, -0.12),
    shirtD = U && U.sleeve ? U.sleeve : shade(shirt, -0.15);
  const view = o.view,
    walk = o.pose === "walk",
    sit = o.pose === "sit",
    tf = o.pose === "typefront";
  const type = o.pose === "type" || tf;
  const step = walk ? o.frame % 4 : 0;
  if (!sit && !type) P(4, 15, 8, 1, "rgba(0,0,0,0.25)");
  // legs
  if (sit) {
    P(5, 12, 6, 2, pants);
    P(4, 13, 2, 1, "#222");
    P(10, 13, 2, 1, "#222");
  } else if (!type) {
    const l = step === 1 ? -1 : 0,
      r = step === 3 ? -1 : 0;
    if (view === "left" || view === "right") {
      P(6, 12 + l, 2, 2, pants);
      P(8, 12 + r, 2, 2, shade(pants, -0.1));
      P(6, 14 + l, 2, 1, "#222");
      P(8, 14 + r, 2, 1, "#222");
    } else {
      P(5, 12 + l, 2, 2, pants);
      P(9, 12 + r, 2, 2, pants);
      P(5, 14 + l, 2, 1, "#222");
      P(9, 14 + r, 2, 1, "#222");
    }
  }
  // body
  P(4, 8, 8, 4, shirt);
  P(4, 11, 8, 1, shirtD);
  if (view === "down" && !U) P(7, 8, 2, 1, shade(shirt, 0.2));
  if (U && U.body) U.body(P, view, o);
  // arms
  if (tf) {
    const up = o.frame % 2;
    P(3, 8, 1, 2, shirtD);
    P(12, 8, 1, 2, shirtD);
    P(4, 10 - up, 1, 1, skin);
    P(11, 9 + up, 1, 1, skin);
  } else if (type) {
    const up = o.frame % 2;
    P(3, 8, 1, 2, shirtD);
    P(12, 8, 1, 2, shirtD);
    P(3, 7 - up, 1, 1, skin);
    P(12, 6 + up, 1, 1, skin);
  } else if (view === "left" || view === "right") {
    const sw = walk ? (step === 1 ? -1 : step === 3 ? 1 : 0) : 0;
    P(7 + sw, 9, 2, 2, shirtD);
    P(7 + sw, 11, 2, 1, skin);
  } else {
    const sw = walk ? (step === 1 ? 1 : step === 3 ? -1 : 0) : 0;
    P(3, 8, 1, 3, shirtD);
    P(12, 8, 1, 3, shirtD);
    P(3, 11 + sw, 1, 1, skin);
    P(12, 11 - sw, 1, 1, skin);
  }
  if (U && U.shortSleeves) {
    if (type) {
      P(3, 9, 1, 1, skin);
      P(12, 9, 1, 1, skin);
    } else if (view === "left" || view === "right") {
      const sws = walk ? (step === 1 ? -1 : step === 3 ? 1 : 0) : 0;
      P(7 + sws, 10, 2, 1, skin);
    } else {
      P(3, 9, 1, 2, skin);
      P(12, 9, 1, 2, skin);
    }
  }
  // head
  P(4, 2, 8, 6, skin);
  P(4, 7, 8, 1, skinD);
  if (view === "up") {
    P(4, 1, 8, 6, hair);
    P(5, 7, 6, 1, skinD);
    if (style === 1) P(3, 2, 10, 6, hair);
    if (style === 3) P(6, 0, 4, 2, shade(hair, -0.1));
  } else {
    P(4, 1, 8, 2, hair);
    if (view === "down") {
      P(4, 3, 1, 2, hair);
      P(11, 3, 1, 2, hair);
    }
    if (view === "left") P(9, 1, 3, 5, hair);
    if (view === "right") P(4, 1, 3, 5, hair);
    if (style === 1) {
      P(3, 2, 1, 6, hair);
      P(12, 2, 1, 6, hair);
    }
    if (style === 2) {
      P(5, 0, 1, 1, hair);
      P(7, 0, 1, 1, hair);
      P(9, 0, 1, 1, hair);
    }
    if (style === 3) P(6, 0, 4, 1, shade(hair, -0.1));
    const eyes = view === "down" ? [6, 9] : view === "left" ? [5] : [10];
    for (const ex of eyes) {
      if (o.closed || o.blink) P(ex, 5, 1, 1, skinD);
      else P(ex, 4, 1, 2, "#1b1b1b");
    }
    if (view === "down") P(7, 6, 2, 1, o.closed ? skinD : "#b5524a");
  }
  // accessories
  if (acc === "glasses" && view !== "up") {
    if (view === "down") {
      P(5, 4, 2, 2, "rgba(20,20,30,.85)");
      P(9, 4, 2, 2, "rgba(20,20,30,.85)");
      P(7, 4, 2, 1, "#111");
    } else P(view === "left" ? 4 : 9, 4, 3, 2, "rgba(20,20,30,.85)");
  }
  if (acc === "headphones") {
    P(4, 0, 8, 1, "#222");
    P(3, 3, 1, 3, accColor);
    P(12, 3, 1, 3, accColor);
  }
  if (acc === "cap") {
    P(4, 0, 8, 2, accColor);
    P(4, 1, 8, 1, shade(accColor, -0.15));
    if (view === "down") P(4, 2, 8, 1, shade(accColor, -0.3));
    if (view === "left") P(2, 2, 5, 1, shade(accColor, -0.3));
    if (view === "right") P(9, 2, 5, 1, shade(accColor, -0.3));
  }
  if (U && U.hat) U.hat(P, view);
  if (U && U.prop && view === "down" && !sit && !type) U.prop(P, view);
}

// A small standalone sprite for the legend.
function spriteCanvas(role) {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 17;
  c.className = "spr";
  const g = c.getContext("2d");
  const look = {
    skin: "#eab991",
    hair: "#5b3a22",
    shirt: role ? roleColor(role) : UNTAGGED,
    pants: "#34495e",
    style: 0,
    acc: "none",
    accColor: "#3498db",
    role,
  };
  drawChar(
    (x, y, w, h, col) => {
      g.fillStyle = col;
      g.fillRect(x, y + 1, w, h);
    },
    look,
    { view: "down", frame: 0, pose: "stand" }
  );
  return c;
}

function drawBubble(g, cx, top, glyph, color) {
  const x = Math.round(cx - 5),
    y = Math.round(top - 10);
  g.fillStyle = "#15131f";
  g.fillRect(x, y, 11, 9);
  g.fillRect(x + 4, y + 9, 3, 1);
  g.fillStyle = "#ffffff";
  g.fillRect(x + 1, y + 1, 9, 7);
  g.fillRect(x + 5, y + 8, 1, 1);
  g.fillStyle = color;
  GLYPH[glyph].forEach((row, ry) => {
    for (let rx = 0; rx < 5; rx++)
      if (row[rx] === "#") g.fillRect(x + 3 + rx, y + 2 + ry, 1, 1);
  });
}

// ---------------------------------------------------------------- entity logic
const rooms = new Map();
let firstLoad = true,
  showAsleep = false,
  soundOn = false,
  selected = null,
  hovered = null;
let currentHost = storeGet("office.host", ""),
  groupBy = storeGet("office.groupBy", "project");
let hostsData = [];
const prevStates = new Map();

// One room per host. Rooms of other hosts stay alive but hidden.
function ensureRoom(host, project, count) {
  const id = host.label + "/" + project;
  let room = rooms.get(id);
  if (!room) {
    room = buildRoom(id);
    room.id = id;
    room.title = projectName(project);
    room.hostLabel = host.label;
    const wrap = document.createElement("div");
    wrap.className = "room";
    wrap.innerHTML = `<div class="room-head"><span class="name"></span><span class="hn"></span><span data-st></span></div>`;
    const cv = document.createElement("canvas");
    wrap.appendChild(cv);
    room.el = wrap;
    room.canvas = cv;
    room.ctx = cv.getContext("2d");
    document.querySelector(".boot")?.remove();
    rooms.set(id, room);
    const box = document.getElementById("rooms");
    [...rooms.values()]
      .sort((p, q) => p.id.localeCompare(q.id))
      .forEach((r) => box.appendChild(r.el));
    attachPointer(room);
  }
  room.id = id;
  room.host = host;
  const head = room.el.querySelector(".room-head");
  head.querySelector(".name").textContent = room.title;
  head.querySelector(".hn").textContent =
    `${count} agent${count === 1 ? "" : "s"}${host.hostname ? " · " + host.hostname : ""}`;
  const st = head.querySelector("[data-st]");
  st.className = host.ok ? "ok" : "err";
  st.textContent = host.ok
    ? "live"
    : "offline · " + (host.error || "unreachable");
  return room;
}

function showHost(label) {
  if (label !== currentHost)
    track("machine_tab_switched", { machines: hostsData.length });
  currentHost = label;
  storeSet("office.host", label);
  if (selected && selected.hostLabel !== label) selected = null;
  for (const r of rooms.values()) r.el.hidden = r.hostLabel !== label;
  resize();
  renderHosts();
  renderSidebar();
}

function renderHosts() {
  const box = document.getElementById("hosts");
  box.innerHTML =
    hostsData.length < 2
      ? ""
      : hostsData
          .map((h) => {
            const need = (h.agents || []).filter(
              (a) => a.state === "needs_input"
            ).length;
            return `<button data-host="${esc(h.label)}" aria-pressed="${h.label === currentHost}">${esc(h.label)} <span>${(h.agents || []).length}</span>${need ? `<span class="alert">${need}!</span>` : ""}</button>`;
          })
          .join("");
}
document.getElementById("hosts").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-host]");
  if (b) showHost(b.dataset.host);
});

function goTo(room, e, spot) {
  const from = {
    tx: Math.floor(e.x / T),
    ty: Math.min(room.H - 1, Math.floor(e.y / T)),
  };
  const tiles = bfs(room, from, { tx: spot.tx, ty: spot.ty }) || [];
  e.path = tiles.map((t) => tileFoot(t.tx, t.ty));
  e.path.push({ x: spot.x, y: spot.y });
}

// A session whose helpers are busy is a manager. Helpers are background Claude Code
// subagents (turned into pseudo agents here) and Paseo child agents that are working.
function expandTeams(h) {
  const agents = (h.agents || []).map((a) => ({ ...a, team: [] }));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const out = [...agents];
  for (const a of agents) {
    for (const sub of (a.subagents || []).filter((x) => x.active)) {
      const p = {
        id: a.id + "~" + sub.id,
        shortId: sub.id.slice(0, 7),
        isSub: true,
        subType: sub.type,
        workspace: sub.description,
        name: "Subagent of " + (a.workspace || a.name),
        status: "running",
        state: "working",
        parentId: a.id,
        labels: { role: roleOf(a) },
        project: a.project,
        cwd: a.cwd,
        provider: "Claude Code subagent" + (sub.type ? " · " + sub.type : ""),
        lastActivityAt: sub.lastAt,
        pending: [],
        workspaceLabels: [],
      };
      out.push(p);
      a.team.push(p.id);
    }
  }
  for (const a of agents)
    if (a.parentId && byId.has(a.parentId) && a.state === "working")
      byId.get(a.parentId).team.push(a.id);
  for (const a of agents)
    if (a.team.length && a.state === "idle") a.state = "managing";
  return out;
}

function poolFor(state) {
  return state === "working"
    ? "work"
    : state === "managing"
      ? "manage"
      : state === "needs_input"
        ? "help"
        : state === "review"
          ? "review"
          : state === "asleep"
            ? "nap"
            : null;
}
function teamOf(room, a) {
  return a.parentId && room.teamSlots.has(a.parentId) && a.state === "working"
    ? a.parentId
    : null;
}

// Spot keys: "work", "help", "nap", "manage" (no room left), "head:<mgr>", "team:<mgr>".
function allocate(room, key, e) {
  const taken = new Set();
  for (const o of room.ents.values())
    if (o !== e && o.spot && o.spot.pool === key)
      taken.add(o.spot.tx + "," + o.spot.ty);
  let list;
  if (key.startsWith("head:"))
    return { ...room.slots[room.teamSlots.get(key.slice(5))].head, pool: key };
  if (key.startsWith("team:")) {
    const sl = room.slots[room.teamSlots.get(key.slice(5))];
    list = [...sl.seats, ...sl.overflow];
  } else if (key === "work") list = [...room.seats, ...room.workOverflow];
  else if (key === "manage") list = room.workOverflow;
  else
    list =
      key === "help" ? room.help : key === "review" ? room.review : room.nap;
  const free = list.find((s) => !taken.has(s.tx + "," + s.ty));
  return free
    ? { ...free, pool: key }
    : { ...list[list.length - 1], pool: key };
}

// Give each manager a room: teams of 3+ get a meeting room, teams of 1-2 a booth, each
// falling back to the other kind when theirs is full. Existing assignments stay put while they fit.
function assignTeamRooms(room, agents) {
  const mgrs = agents
    .filter((a) => a.team && a.team.length && a.state !== "asleep")
    .sort((p, q) => q.team.length - p.team.length);
  const byId = new Map(mgrs.map((a) => [a.id, a]));
  for (const [id, i] of [...room.teamSlots]) {
    const a = byId.get(id);
    if (!a || a.team.length > room.slots[i].cap) room.teamSlots.delete(id);
  }
  const used = new Set(room.teamSlots.values());
  const free = (kind, size) =>
    room.slots.find(
      (sl) => sl.kind === kind && !used.has(sl.i) && size <= sl.cap
    );
  for (const a of mgrs) {
    if (room.teamSlots.has(a.id)) continue;
    const n = a.team.length;
    const sl =
      n >= 3
        ? free("meeting", n) || free("booth", n)
        : free("booth", n) || free("meeting", n);
    if (sl) {
      room.teamSlots.set(a.id, sl.i);
      used.add(sl.i);
    }
  }
}

function syncRoom(room, host) {
  const seen = new Set();
  assignTeamRooms(room, host.agents || []);
  for (const a of host.agents || []) {
    const key = host.label + ":" + a.id;
    seen.add(key);
    let e = room.ents.get(key);
    if (!e) {
      const start = tileFoot(ENTRANCE.tx, ENTRANCE.ty);
      e = {
        key,
        look: makeLook(a.id),
        x: start.x,
        y: start.y,
        path: [],
        view: "up",
        frame: 0,
        ft: 0,
        pause: Math.random() * 3,
        spot: null,
        state: null,
        fresh: firstLoad,
      };
      room.ents.set(key, e);
    }
    e.agent = a;
    e.hostLabel = host.label;
    e.target = host.target;
    e.leaving = false;
    e.look.shirt = roleColor(roleOf(a));
    e.look.role = roleOf(a);
    e.hidden = a.state === "asleep" && !showAsleep;
    const pool = e.hidden ? null : poolFor(a.state);
    let spotKey = pool;
    if (
      room.teamSlots.has(a.id) &&
      (a.state === "working" || a.state === "managing")
    )
      spotKey = "head:" + a.id;
    else if (pool === "work" && teamOf(room, a))
      spotKey = "team:" + teamOf(room, a);
    if (
      e.state !== a.state ||
      (pool && !e.spot) ||
      (!pool && e.spot) ||
      (e.spot && spotKey && e.spot.pool !== spotKey)
    ) {
      e.state = a.state;
      e.spot = null;
      if (pool) {
        e.spot = allocate(room, spotKey, e);
        if (e.fresh) {
          e.x = e.spot.x;
          e.y = e.spot.y;
          e.path = [];
        } else goTo(room, e, e.spot);
      } else if (a.state === "idle") {
        e.pause = 0;
        if (e.fresh) {
          const t = pick(Math.random, lounge(room));
          Object.assign(e, tileFoot(t.tx, t.ty));
          e.pause = Math.random() * 4;
        }
      }
    }
    e.fresh = false;
  }
  for (const [key, e] of room.ents) {
    if (seen.has(key) || e.leaving) continue;
    e.leaving = true;
    e.spot = null;
    e.state = "leaving";
    goTo(room, e, { ...tileFoot(ENTRANCE.tx, ENTRANCE.ty), ...ENTRANCE });
  }
}

function update(room, dt) {
  for (const [key, e] of room.ents) {
    if (e.hidden) continue;
    if (e.path.length) {
      const p = e.path[0],
        dx = p.x - e.x,
        dy = p.y - e.y,
        d = Math.hypot(dx, dy),
        step = SPEED * dt;
      if (Math.abs(dx) > Math.abs(dy)) e.view = dx > 0 ? "right" : "left";
      else if (d > 0.01) e.view = dy > 0 ? "down" : "up";
      if (d <= step) {
        e.x = p.x;
        e.y = p.y;
        e.path.shift();
      } else {
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
      e.ft += dt;
      if (e.ft > 0.14) {
        e.ft = 0;
        e.frame++;
      }
      if (!e.path.length) {
        if (e.leaving) {
          room.ents.delete(key);
          continue;
        }
        if (e.state === "idle") e.pause = 2 + Math.random() * 7;
        if (e.state === "needs_input" || e.state === "review") e.view = "down";
        if (e.spot && e.spot.kind === "seat") e.view = "up";
        if (e.spot && e.spot.kind === "tseat")
          e.view = e.spot.side === "top" ? "down" : "up";
        if (e.spot && e.spot.kind === "head") e.view = "left";
        if (e.spot && e.spot.pool === "nap") e.view = "down";
      }
      continue;
    }
    if (e.state === "idle") {
      e.pause -= dt;
      if (e.pause <= 0) {
        const tiles = lounge(room),
          t = tiles[Math.floor(Math.random() * tiles.length)];
        if (t) goTo(room, e, { ...t, ...tileFoot(t.tx, t.ty) });
        e.pause = 3;
      } else if (Math.random() < dt * 0.15)
        e.view = pick(Math.random, ["down", "left", "right", "up"]);
    }
    if (
      e.state === "working" &&
      e.spot &&
      (e.spot.kind === "seat" || e.spot.kind === "tseat")
    ) {
      e.ft += dt;
      if (e.ft > 0.18) {
        e.ft = 0;
        e.frame++;
      }
    }
  }
}

// ---------------------------------------------------------------- rendering
let scale = 2;
function resize() {
  for (const room of rooms.values()) {
    if (room.el.hidden) continue;
    const w = room.canvas.clientWidth || room.el.clientWidth || PW;
    scale = Math.max(1, Math.ceil((w / PW) * (window.devicePixelRatio || 1)));
    room.canvas.width = PW * scale;
    room.canvas.height = room.PH * scale;
  }
}
window.addEventListener("resize", resize);

function skyColors() {
  const h = new Date().getHours();
  if (h >= 7 && h < 17) return { sky: "#8fd3ff", low: "#c8ecff", stars: false };
  if (h >= 17 && h < 19)
    return { sky: "#f39c6b", low: "#ffd29a", stars: false };
  if (h >= 5 && h < 7) return { sky: "#9a8fd6", low: "#f5b7a0", stars: false };
  return { sky: "#1d2550", low: "#2c3570", stars: true };
}

function render(room, t) {
  const g = room.ctx,
    s = room.canvas.width / PW;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(room.bg, 0, 0, room.canvas.width, room.canvas.height);
  g.setTransform(s, 0, 0, s, 0, 0);
  const R = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };

  // windows
  const sky = skyColors();
  for (const wx of [16, 72, 128]) {
    R(wx - 2, 8, 40, 28, "#d9d9e3");
    R(wx, 10, 36, 24, sky.sky);
    R(wx, 26, 36, 8, sky.low);
    if (sky.stars)
      [
        [4, 3],
        [14, 7],
        [27, 4],
        [31, 12],
        [9, 13],
        [21, 2],
      ].forEach(([a, b]) => R(wx + a, 10 + b, 1, 1, "#fff8c4"));
    else {
      R((wx + 6 + ((t / 400 + wx) % 30)) | 0, 14, 8, 3, "#ffffff");
    }
    R(wx + 17, 10, 2, 24, "#d9d9e3");
    R(wx, 21, 36, 2, "#d9d9e3");
  }
  // plaque + clock
  g.font = "8px Silkscreen, monospace";
  g.textBaseline = "top";
  g.textAlign = "center";
  g.fillStyle = "#f1e4c3";
  g.fillText((room.title || room.label).toUpperCase().slice(0, 10), 303, 13);
  R(334, 12, 4, 4, room.host && room.host.ok ? "#4cd964" : "#ff3b30");
  const now = new Date(),
    clock =
      String(now.getHours()).padStart(2, "0") +
      (now.getSeconds() % 2 ? ":" : " ") +
      String(now.getMinutes()).padStart(2, "0");
  R(346, 10, 32, 13, "#111");
  g.fillStyle = "#ff6b6b";
  g.fillText(clock, 362, 12);
  // floor labels
  g.fillStyle = "rgba(255, 236, 170, 0.9)";
  g.fillText("NEEDS YOU", 19 * T, 14 * T + 4);
  g.fillText("READY TO REVIEW", 6.5 * T, 14 * T + 4);
  g.fillStyle = "rgba(255, 255, 255, 0.35)";
  g.fillText("LOUNGE", 19 * T, 5 * T + 8);

  // occupied seats
  const seatUser = new Map();
  for (const e of room.ents.values())
    if (
      !e.hidden &&
      e.spot &&
      e.spot.kind === "seat" &&
      !e.path.length &&
      e.state === "working"
    )
      seatUser.set(e.spot.dx + "," + e.spot.dy, e);
  // team rooms: carpet tint and name plate per manager; vacant rooms stay dim
  const mgrOfSlot = new Map(
    [...room.teamSlots].map(([id, i]) => [
      i,
      room.ents.get(room.host.label + ":" + id),
    ])
  );
  for (const sl of room.slots) {
    const I = sl.inner,
      mgr = mgrOfSlot.get(sl.i),
      live = mgr && mgr.agent;
    if (live) {
      g.globalAlpha = 0.22;
      R(I.x * T, I.y * T, I.w * T, I.h * T, roleColor(roleOf(mgr.agent)));
      g.globalAlpha = 1;
    } else {
      g.fillStyle = "rgba(10,8,20,0.3)";
      g.fillRect(I.x * T, I.y * T, I.w * T, I.h * T);
    }
    const name = live
      ? String(mgr.agent.workspace || mgr.agent.name).toUpperCase()
      : sl.kind === "booth"
        ? "BOOTH"
        : "MEETING ROOM";
    g.font = "8px Silkscreen, monospace";
    g.textAlign = "left";
    let label = name;
    while (label.length > 1 && g.measureText(label).width > sl.plate.w - 10)
      label = label.slice(0, -1);
    if (label !== name) label = label.slice(0, -1) + "…";
    R(sl.plate.x - 1, sl.plate.y - 1, sl.plate.w + 2, 12, "#1f1c2d");
    R(
      sl.plate.x + 1,
      sl.plate.y + 2,
      5,
      5,
      live ? roleColor(roleOf(mgr.agent)) : "#555"
    );
    g.fillStyle = live ? "#fff6d5" : "#8a84a8";
    g.fillText(label, sl.plate.x + 8, sl.plate.y);
    g.textAlign = "center";
  }
  // monitors
  for (const st of room.seats) {
    const x = st.dx * T + 10,
      y = st.dy * T - 6,
      user = seatUser.get(st.dx + "," + st.dy);
    if (user) {
      R(x, y, 12, 8, "#0b2b26");
      const r = rng(hash(user.key) + Math.floor(t / 260));
      for (let i = 0; i < 3; i++)
        R(
          x + 1 + (i === 1 ? 2 : 0),
          y + 1 + i * 2,
          2 + Math.floor(r() * 8),
          1,
          i === 2 ? "#ffd166" : "#4cc38a"
        );
      g.fillStyle = "rgba(76, 195, 138, 0.12)";
      g.fillRect(x - 3, y - 3, 18, 14);
    } else {
      R(x, y, 12, 8, "#1a1c2c");
      R(x + 10, y + 6, 1, 1, "#ff9f43");
    }
  }

  // depth-sorted drawables
  const items = [];
  for (const st of room.seats) {
    const cx = st.x,
      cy = st.y;
    items.push({
      y: cy - 6,
      draw: () => {
        R(cx - 6, cy - 9, 12, 5, "#546e7a");
      },
    });
    items.push({
      y: cy + 0.5,
      draw: () => {
        R(cx - 6, cy - 5, 12, 5, "#37474f");
        R(cx - 6, cy - 5, 12, 1, "#607d8b");
        R(cx - 1, cy, 2, 1, "#263238");
        R(cx - 4, cy + 1, 8, 1, "#263238");
      },
    });
  }
  const tseatUser = new Map();
  for (const e of room.ents.values())
    if (
      !e.hidden &&
      e.spot &&
      e.spot.kind === "tseat" &&
      !e.path.length &&
      e.state === "working"
    )
      tseatUser.set(e.spot.tx + "," + e.spot.ty, e);
  for (const sl of room.slots) {
    for (const st of sl.seats) {
      const cx = st.x,
        cy = st.y;
      if (st.side === "top")
        items.push({
          y: cy - 1,
          draw: () => {
            R(cx - 6, cy - 13, 12, 6, "#37474f");
            R(cx - 6, cy - 13, 12, 1, "#607d8b");
          },
        });
      else {
        items.push({
          y: cy - 6,
          draw: () => R(cx - 6, cy - 9, 12, 5, "#546e7a"),
        });
        items.push({
          y: cy + 0.5,
          draw: () => {
            R(cx - 6, cy - 5, 12, 5, "#37474f");
            R(cx - 6, cy - 5, 12, 1, "#607d8b");
            R(cx - 4, cy + 1, 8, 1, "#263238");
          },
        });
      }
    }
    const tb = sl.table;
    items.push({
      y: tb.y + tb.h + 1,
      draw: () => {
        const tx = tb.x,
          ty = tb.y;
        R(tx, ty, tb.w, tb.h, "#6d4c41");
        R(tx + 1, ty, tb.w - 2, tb.h - 3, "#8d6e63");
        R(tx + 1, ty, tb.w - 2, 2, "#a1887f");
        for (const st of sl.seats) {
          const u = tseatUser.get(st.tx + "," + st.ty),
            lx = st.x - 4;
          if (!u) continue;
          if (st.side === "top") {
            R(lx, ty + 3, 8, 5, "#b2bec3");
            R(lx + 3, ty + 5, 2, 1, "#dfe6e9");
          } else {
            const r = rng(hash(u.key) + Math.floor(t / 260)),
              ly = ty + tb.h - 10;
            R(lx, ly, 8, 6, "#0b2b26");
            R(lx + 1, ly + 1, 2 + Math.floor(r() * 5), 1, "#4cc38a");
            R(lx + 1, ly + 3, 2 + Math.floor(r() * 5), 1, "#ffd166");
            R(lx - 1, ly + 6, 10, 2, "#b2bec3");
          }
        }
        if (sl.kind === "meeting") {
          R(tx + 2 * T, ty + 10, 6, 5, "#ffffff");
          R(tx + 2 * T + 1, ty + 11, 4, 2, "#8d6e63");
        } // coffee
      },
    });
  }
  const bubbles = [];
  for (const e of room.ents.values()) {
    if (e.hidden) continue;
    const a = e.agent || {};
    const atSpot = !e.path.length;
    let pose = e.path.length ? "walk" : "stand",
      view = e.view,
      dy = 0;
    if (atSpot && e.spot && e.spot.kind === "seat" && e.state === "working") {
      pose = "type";
      view = "up";
      dy = -4;
    }
    if (atSpot && e.spot && e.spot.kind === "tseat" && e.state === "working") {
      if (e.spot.side === "top") {
        pose = "typefront";
        view = "down";
      } else {
        pose = "type";
        view = "up";
        dy = -4;
      }
    }
    if (atSpot && e.spot && e.spot.kind === "head") view = "left";
    if (atSpot && e.state === "asleep") {
      pose = e.spot && e.spot.kind !== "floor" ? "sit" : "sit";
      view = "down";
    }
    const bob =
      e.state === "needs_input" && atSpot
        ? Math.round(Math.sin(t / 180 + e.look.phase) > 0.6 ? -1 : 0)
        : 0;
    const sx = Math.round(e.x - 8),
      sy = Math.round(e.y - 15 + dy + bob);
    const blink = Math.sin(t / 900 + e.look.phase * 7) > 0.985;
    items.push({
      y: e.y,
      draw: () => {
        if (e.state === "needs_input" && atSpot) {
          const on = Math.floor(t / 400) % 2;
          g.fillStyle = on
            ? "rgba(255, 93, 108, 0.55)"
            : "rgba(255, 93, 108, 0.25)";
          g.fillRect(sx + 1, Math.round(e.y) - 1, 14, 3);
        }
        if (e === selected || e === hovered) {
          g.fillStyle = e === selected ? "#f2c14e" : "rgba(255,255,255,0.6)";
          g.fillRect(sx + 2, Math.round(e.y), 12, 1);
        }
        if (e.state === "asleep") g.globalAlpha = 0.8;
        drawChar(
          (x, y, w, h, c) => {
            g.fillStyle = c;
            g.fillRect(sx + x, sy + y, w, h);
          },
          e.look,
          { view, frame: e.frame, pose, blink, closed: e.state === "asleep" }
        );
        g.globalAlpha = 1;
        if (e.state === "review" && atSpot) {
          // holding up the finished work
          g.fillStyle = "#2d3436";
          g.fillRect(sx + 4, sy + 8, 8, 6);
          g.fillStyle = "#ffffff";
          g.fillRect(sx + 5, sy + 8, 6, 5);
          g.fillStyle = "#9aa5b1";
          g.fillRect(sx + 6, sy + 9, 4, 1);
          g.fillRect(sx + 6, sy + 11, 3, 1);
        }
      },
    });
    // bubble choice
    let glyph = null,
      color = "#d93245";
    if (e.state === "needs_input") {
      glyph =
        a.attentionReason === "error" || a.status === "error"
          ? "x"
          : (a.pending && a.pending.length) ||
              a.attentionReason === "permission"
            ? "!"
            : "?";
    } else if (e.state === "asleep" && atSpot) {
      glyph = "z";
      color = "#5b6cff";
    } else if (e.state === "managing") {
      glyph = "*";
      color = "#e1a800";
    } else if (
      e.state === "review" ||
      (e.state === "idle" && a.attentionReason === "finished")
    ) {
      glyph = "v";
      color = "#2e9d4f";
    } else if (
      e.state === "working" &&
      atSpot &&
      e.spot &&
      e.spot.kind === "floor"
    ) {
      glyph = ".";
      color = "#2e9d4f";
    } else if (
      e.state === "idle" &&
      atSpot &&
      Math.sin(t / 2300 + e.look.phase * 3) > 0.93
    ) {
      glyph = "n";
      color = "#7d4cdb";
    }
    if (glyph) {
      const lift =
        glyph === "z"
          ? Math.round((t / 300 + e.look.phase) % 3)
          : glyph === "!" || glyph === "?" || glyph === "x"
            ? Math.floor(t / 250) % 2
            : 0;
      bubbles.push(() => drawBubble(g, sx + 8, sy - lift, glyph, color));
    }
    if (e === selected)
      bubbles.push(() => {
        const ay = sy - (glyph ? 14 : 4) - (Math.floor(t / 300) % 2);
        g.fillStyle = "#15131f";
        g.fillRect(sx + 4, ay - 1, 9, 5);
        g.fillStyle = "#f2c14e";
        g.fillRect(sx + 5, ay, 7, 1);
        g.fillRect(sx + 6, ay + 1, 5, 1);
        g.fillRect(sx + 7, ay + 2, 3, 1);
        g.fillRect(sx + 8, ay + 3, 1, 1);
      });
  }
  items.sort((p, q) => p.y - q.y).forEach((it) => it.draw());
  bubbles.forEach((b) => b());

  if (room.host && !room.host.ok) {
    g.fillStyle = "rgba(10, 8, 20, 0.6)";
    g.fillRect(0, 0, PW, room.PH);
    g.fillStyle = "#ff6b6b";
    g.font = "8px 'Press Start 2P', monospace";
    g.fillText("CONNECTION LOST", PW / 2, room.PH / 2 - 6);
  }
}

// ---------------------------------------------------------------- pointer
function attachPointer(room) {
  const cv = room.canvas,
    tip = document.getElementById("tip");
  const hit = (ev) => {
    const r = cv.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * PW,
      py = ((ev.clientY - r.top) / r.height) * room.PH;
    let best = null;
    for (const e of room.ents.values()) {
      if (e.hidden || e.leaving) continue;
      if (
        px >= e.x - 7 &&
        px <= e.x + 7 &&
        py >= e.y - 17 &&
        py <= e.y + 1 &&
        (!best || e.y > best.y)
      )
        best = e;
    }
    return best;
  };
  cv.addEventListener("mousemove", (ev) => {
    hovered = hit(ev);
    cv.style.cursor = hovered ? "pointer" : "default";
    if (hovered && hovered.agent) {
      const a = hovered.agent;
      tip.innerHTML = `<div class="t">${esc(a.workspace || a.name)}</div><div class="s">${esc(roleOf(a) || "untagged")} · ${esc(STATE_LABEL[a.state])}${a.attentionReason ? " · " + esc(a.attentionReason) : ""}</div>${a.workspace ? `<div>${esc(a.name)}</div>` : ""}`;
      tip.style.display = "block";
      const x = Math.min(
        ev.clientX + 14,
        window.innerWidth - tip.offsetWidth - 8
      );
      tip.style.left = x + "px";
      tip.style.top = ev.clientY + 16 + "px";
    } else tip.style.display = "none";
  });
  cv.addEventListener("mouseleave", () => {
    hovered = null;
    tip.style.display = "none";
  });
  cv.addEventListener("click", (ev) => {
    const e = hit(ev);
    select(e ? e.key : null, "office");
  });
}

// ---------------------------------------------------------------- sidebar
function allEnts() {
  const out = [];
  for (const r of rooms.values())
    for (const e of r.ents.values()) if (!e.leaving && e.agent) out.push(e);
  return out;
}
function findEnt(key) {
  for (const r of rooms.values()) if (r.ents.has(key)) return r.ents.get(key);
  return null;
}

function select(key, source = "sidebar") {
  selected = key ? findEnt(key) : null;
  if (selected && selected.agent)
    track("agent_selected", {
      source,
      state: selected.agent.state,
      role: roleForAnalytics(roleOf(selected.agent)),
      is_subagent: Boolean(selected.agent.isSub),
      is_manager: Boolean(selected.agent.team && selected.agent.team.length),
    });
  renderSidebar();
}

/** CLI command to run on the machine that hosts the agent. */
function cmdFor(e, verb) {
  return `paseo ${verb} ${e.agent.shortId || e.agent.id.slice(0, 7)}`;
}

function rowHtml(e, child) {
  const a = e.agent,
    role = roleOf(a);
  const colors =
    (hostsData.find((h) => h.label === e.hostLabel) || {}).labelColors || {};
  const wl = (a.workspaceLabels || [])
    .map((l) => {
      const c = LABEL_COLORS[colors[l]] || "#9ca3af";
      return `<span class="wlabel" style="border-color:${c};color:${c}">${esc(l)}</span>`;
    })
    .join("");
  const others = Object.entries(a.labels || {})
    .filter(([k]) => k !== "role" && k !== "role-source")
    .map(
      ([k, v]) =>
        `<span class="wlabel" style="border-color:var(--border)">${esc(k)}=${esc(v)}</span>`
    )
    .join("");
  const roleChip = role
    ? `<span class="role" style="background:${roleColor(role)}">${esc(role)}</span>`
    : `<span class="role none">untagged</span>`;
  let extra =
    a.attentionReason === "finished" && a.state !== "review"
      ? '<span class="badge done">done</span> '
      : "";
  if (a.team && a.team.length)
    extra += `<span class="badge work">team of ${a.team.length}</span> `;
  if (a.isSub)
    return `<li data-key="${esc(e.key)}" class="${selected === e ? "sel" : ""} child" title="${esc(a.workspace)}">
    <span class="dot work"></span><span class="title">⚙ ${esc(a.workspace)}</span><span class="when">${esc(ago(a.lastActivityAt))}</span>
    <span class="meta">${esc(a.provider)}</span></li>`;
  const perm =
    a.pending && a.pending.length
      ? " · " + esc(a.pending[0].toolName || a.pending[0].title || "permission")
      : "";
  return `<li data-key="${esc(e.key)}" class="${selected === e ? "sel" : ""}${child ? " child" : ""}${a.state === "asleep" ? " closed" : ""}" title="${esc(a.name)}">
    <span class="dot ${STATE_CLASS[a.state]}"></span>
    <span class="title">${a.scheduleName ? "⏰ " + esc(a.scheduleName) : esc(a.workspace || a.name)}</span>
    <span class="when">${esc(ago(a.lastActivityAt))}</span>
    <span class="meta">${roleChip}${wl}${others}${extra}${esc(a.workspace ? a.name : base(a.cwd))}${perm}</span>
  </li>`;
}

// Parents first, each followed by its subagents.
function withChildren(list, pool) {
  const byId = new Map(list.map((e) => [e.agent.id, e]));
  const out = [],
    kids = new Map();
  for (const e of [...list, ...(pool || []).filter((x) => x.agent.isSub)]) {
    const p = e.agent.parentId;
    if (p && byId.has(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(e);
    }
  }
  for (const e of list) {
    if (e.agent.parentId && byId.has(e.agent.parentId)) continue;
    out.push([e, false]);
    for (const k of kids.get(e.agent.id) || []) out.push([k, true]);
  }
  return out;
}

function renderSidebar() {
  const everyone = allEnts().filter((e) => e.hostLabel === currentHost);
  const ents = everyone.filter((e) => !e.agent.isSub);
  const byRecent = (p, q) =>
    (Date.parse(q.agent.lastActivityAt || 0) || 0) -
    (Date.parse(p.agent.lastActivityAt || 0) || 0);
  ents.sort(byRecent);
  const counts = {
    needs_input: 0,
    review: 0,
    working: 0,
    managing: 0,
    idle: 0,
    asleep: 0,
  };
  for (const e of ents)
    counts[e.agent.state] = (counts[e.agent.state] || 0) + 1;

  const need = ents.filter((e) => e.agent.state === "needs_input");
  document.getElementById("n-need").textContent = need.length;
  document.getElementById("l-need").innerHTML = need.length
    ? need.map((e) => rowHtml(e, false)).join("")
    : `<div class="empty">Nobody is waiting on you.</div>`;
  const review = ents.filter((e) => e.agent.state === "review");
  document.getElementById("n-review").textContent = review.length;
  document.getElementById("l-review").innerHTML = review.length
    ? review.map((e) => rowHtml(e, false)).join("")
    : `<div class="empty">Nothing to review.</div>`;

  const listed = ents.filter((e) => showAsleep || e.agent.state !== "asleep");
  document.getElementById("n-all").textContent =
    listed.length + (showAsleep ? "" : ` (+${counts.asleep} closed)`);
  const groups = new Map();
  const keyOf = (e) =>
    groupBy === "role"
      ? roleOf(e.agent) || "untagged"
      : groupBy === "state"
        ? STATE_LABEL[e.agent.state]
        : projectName(e.agent.project);
  for (const e of listed) {
    const k = keyOf(e);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const order =
    groupBy === "state"
      ? [
          "Needs you",
          "Ready to review",
          "Managing",
          "Working",
          "Idle",
          "Closed",
        ]
      : [...groups.keys()].sort(
          (p, q) =>
            (p === "untagged") - (q === "untagged") ||
            groups.get(q).length - groups.get(p).length
        );
  document.getElementById("groups").innerHTML =
    order
      .filter((k) => groups.has(k))
      .map((k) => {
        const list = groups.get(k);
        if (groupBy === "project")
          list.sort(
            (p, q) =>
              roleOf(p.agent).localeCompare(roleOf(q.agent)) || byRecent(p, q)
          );
        const head =
          groupBy === "role" && k !== "untagged"
            ? `<span class="role" style="background:${roleColor(k)}">${esc(k)}</span>`
            : esc(k);
        return `<div class="gbox"><div class="grp">${head}<span class="n">${list.length}</span></div><ul class="list">${withChildren(
          list,
          everyone
        )
          .map(([e, c]) => rowHtml(e, c && groupBy !== "state"))
          .join("")}</ul></div>`;
      })
      .join("") || `<div class="empty">No agents.</div>`;
  for (const b of document.querySelectorAll("#groupby button"))
    b.setAttribute("aria-pressed", b.dataset.by === groupBy);

  const used = new Map();
  for (const e of ents) {
    const r = roleOf(e.agent) || "untagged";
    used.set(r, (used.get(r) || 0) + 1);
  }
  const legend = document.getElementById("legend");
  const roles = [
    ...Object.keys(ROLES),
    ...[...used.keys()].filter((r) => !ROLES[r] && r !== "untagged"),
    "untagged",
  ];
  const sig = roles.map((r) => r + (used.get(r) || 0)).join("|");
  if (legend.dataset.sig !== sig) {
    legend.dataset.sig = sig;
    legend.innerHTML = "";
    for (const r of roles) {
      const row = document.createElement("div");
      row.className = "leg";
      row.title = ROLES[r]
        ? ROLES[r].hint
        : r === "untagged"
          ? "No role label yet"
          : "";
      row.appendChild(spriteCanvas(r === "untagged" ? "" : r));
      row.insertAdjacentHTML(
        "beforeend",
        `<span><b>${esc(r)}</b> ${used.get(r) || 0}<br><small>${esc(ROLES[r] ? ROLES[r].outfit : r === "untagged" ? "plain grey tee" : "coloured shirt")}</small></span>`
      );
      legend.appendChild(row);
    }
  }
  const c = document.getElementById("counts");
  const chip = (cls, label, n) =>
    `<span class="chip ${cls}${n ? "" : " zero"}"><span class="dot"></span>${label} <b>${n}</b></span>`;
  c.innerHTML =
    chip("need", "Needs you", counts.needs_input) +
    chip("review", "Review", counts.review) +
    chip("work", "Managing", counts.managing) +
    chip("work", "Working", counts.working) +
    chip("idle", "Idle", counts.idle) +
    chip("sleep", "Closed", counts.asleep);
  const totalNeed = hostsData.reduce(
    (n, h) =>
      n + (h.agents || []).filter((a) => a.state === "needs_input").length,
    0
  );
  document.title = (totalNeed ? `(${totalNeed}) ` : "") + "Scranton";

  const card = document.getElementById("detail-card");
  if (!selected || !selected.agent) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const a = selected.agent,
    e = selected;
  if (a.isSub) {
    const boss = allEnts().find((x) => x.agent.id === a.parentId);
    document.getElementById("detail").innerHTML =
      `<div class="big">⚙ ${esc(a.workspace)}</div>
      <div><span class="badge work">Working</span></div>
      <dl class="kv"><dt>Manager</dt><dd>${esc(boss ? boss.agent.workspace || boss.agent.name : a.parentId)}</dd>
      <dt>Kind</dt><dd>${esc(a.provider)}</dd><dt>Last write</dt><dd>${esc(ago(a.lastActivityAt))} ago</dd></dl>
      <div class="empty" style="padding:0">Background subagent inside the manager's Claude Code session. Paseo cannot attach to it; follow it through the manager.</div>
      <div class="cmd"><code>${esc(cmdFor(boss || e, "logs"))}</code><button data-copy="${esc(cmdFor(boss || e, "logs"))}">Copy</button></div>`;
    return;
  }
  const perms = (a.pending || [])
    .map(
      (p) =>
        `<div class="perm"><b>${esc(p.toolName || p.kind || "Permission")}</b>${esc(p.title || "")}${p.description ? "<br>" + esc(p.description) : ""}</div>`
    )
    .join("");
  const reason = a.attentionReason
    ? REASON_LABEL[a.attentionReason] || a.attentionReason
    : "";
  const parent = a.parentId
    ? allEnts().find((x) => x.agent.id === a.parentId)
    : null;
  const labels = Object.entries(a.labels || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  document.getElementById("detail").innerHTML = `
    <div class="big">${esc(a.workspace || a.name)}</div>
    <div>${roleOf(a) ? `<span class="role" style="background:${roleColor(roleOf(a))}">${esc(roleOf(a))}</span>` : `<span class="role none">untagged</span>`}<span class="badge ${STATE_CLASS[a.state]}">${esc(STATE_LABEL[a.state])}</span> ${reason ? `<span class="badge ${a.attentionReason === "finished" ? "done" : "need"}">${esc(reason)}</span>` : ""}</div>
    ${perms}
    <dl class="kv">
      <dt>Prompt</dt><dd>${esc(a.name)}</dd>
      <dt>Project</dt><dd>${esc(projectName(a.project))} · ${esc(e.hostLabel)}</dd>
      <dt>Labels</dt><dd>${esc([...(a.workspaceLabels || []), labels].filter(Boolean).join(", ") || "none")}</dd>
      ${a.scheduleId ? `<dt>Schedule</dt><dd>${esc(a.scheduleName || a.scheduleId)}</dd>` : ""}
      ${parent ? `<dt>Parent</dt><dd>${esc(parent.agent.workspace || parent.agent.name)}</dd>` : ""}
      <dt>Folder</dt><dd>${esc(a.cwd)}</dd>
      <dt>Status</dt><dd>${esc(a.status)} · active ${esc(ago(a.lastActivityAt))} ago</dd>
      <dt>Model</dt><dd>${esc(a.provider)}</dd>
      <dt>ID</dt><dd>${esc(a.id)}</dd>
    </dl>
    ${["attach", "logs", "agent update --label role=ROLE"]
      .map((v) => {
        const cmd = v.startsWith("agent")
          ? cmdFor(e, "agent update").replace(
              /agent update (\S+)$/,
              "agent update $1 --label role=ROLE"
            )
          : cmdFor(e, v);
        return `<div class="cmd"><code>${esc(cmd)}</code><button data-copy="${esc(cmd)}">Copy</button></div>`;
      })
      .join("")}`;
}

document.getElementById("groupby").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-by]");
  if (b) {
    groupBy = b.dataset.by;
    storeSet("office.groupBy", groupBy);
    track("agents_grouped", { group_by: groupBy });
    renderSidebar();
  }
});

document.getElementById("detail-close").addEventListener("click", (ev) => {
  ev.stopPropagation();
  select(null);
});
document.querySelector("aside").addEventListener("click", (ev) => {
  const copy = ev.target.closest("[data-copy]");
  if (copy) {
    navigator.clipboard.writeText(copy.dataset.copy);
    track("command_copied", {
      command: (copy.dataset.copy.match(/paseo (\w+)/) || [])[1] || "other",
    });
    copy.textContent = "Copied";
    setTimeout(() => (copy.textContent = "Copy"), 1200);
    return;
  }
  const li = ev.target.closest("li[data-key]");
  if (li)
    select(
      li.dataset.key === (selected && selected.key) ? null : li.dataset.key
    );
});

// ---------------------------------------------------------------- alerts
let audio = null;
function chime() {
  if (!soundOn) return;
  audio = audio || new (window.AudioContext || window.webkitAudioContext)();
  [660, 880, 1320].forEach((f, i) => {
    const o = audio.createOscillator(),
      gn = audio.createGain(),
      t0 = audio.currentTime + i * 0.09;
    o.type = "square";
    o.frequency.value = f;
    gn.gain.setValueAtTime(0.06, t0);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(gn).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + 0.13);
  });
}
function checkAlerts(hosts) {
  const fresh = [];
  for (const h of hosts)
    for (const a of h.agents || []) {
      const key = h.label + ":" + a.id,
        prev = prevStates.get(key);
      if (
        a.state === "needs_input" &&
        prev !== undefined &&
        prev !== "needs_input"
      )
        fresh.push({ a, h });
      prevStates.set(key, a.state);
    }
  if (!fresh.length) return;
  chime();
  if (
    soundOn &&
    "Notification" in window &&
    Notification.permission === "granted"
  )
    for (const { a, h } of fresh)
      new Notification("Agent needs you · " + h.label, {
        body: a.name,
        tag: h.label + a.id,
      });
}
document.getElementById("btn-sound").addEventListener("click", (ev) => {
  soundOn = !soundOn;
  track("alerts_toggled", { enabled: soundOn });
  ev.target.setAttribute("aria-pressed", soundOn);
  ev.target.textContent = soundOn ? "Sound on" : "Sound off";
  if (soundOn) {
    chime();
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }
});
document.getElementById("btn-asleep").addEventListener("click", (ev) => {
  showAsleep = !showAsleep;
  track("closed_agents_toggled", { shown: showAsleep });
  ev.target.setAttribute("aria-pressed", showAsleep);
  ev.target.textContent = showAsleep ? "Hide closed" : "Show closed";
  for (const r of rooms.values())
    if (r.host)
      syncRoom(r, {
        ...r.host,
        agents: [...r.ents.values()]
          .filter((e) => !e.leaving && e.agent)
          .map((e) => e.agent),
      });
  renderSidebar();
});

// ---------------------------------------------------------------- loop
/** Once per page load: what the visitor is looking at, in counts and states only. */
let loadReported = false;
function reportLoad(data) {
  const live = data.hosts.filter((h) => h.ok);
  const agents = data.hosts.flatMap((h) => h.agents || []);
  setContext({
    mode: data.demo ? "demo" : "live",
    machines: data.demo ? 0 : data.hosts.length,
  });
  if (
    loadReported ||
    (!data.demo && !live.length && data.hosts.some((h) => !h.error))
  )
    return;
  loadReported = true;
  const count = (state) =>
    bucket(agents.filter((a) => a.state === state).length);
  track("office_loaded", {
    mode: data.demo ? "demo" : "live",
    machines: data.demo ? 0 : data.hosts.length,
    machines_reachable: data.demo ? 0 : live.length,
    agents: bucket(agents.length),
    needs_input: count("needs_input"),
    ready_to_review: count("review"),
    working: count("working"),
    teams: bucket(
      agents.filter((a) => (a.subagents || []).some((x) => x.active)).length
    ),
  });
}

// A poll stuck on a dead connection must not hold up a fresh one, so each poll carries a
// generation and only the latest one applies its result and schedules the next.
let pollGen = 0;
let pollTimer = null;
let pollScheduledAt = Date.now();
async function poll() {
  const gen = ++pollGen;
  clearTimeout(pollTimer);
  // A visible tab whose timer fired far too late: the computer slept, and no visibility event
  // fires for that when Safari stays the front window.
  const lateMs = Date.now() - pollScheduledAt - POLL_MS;
  if (!document.hidden && lateMs >= STALE_AFTER_MS)
    wake({ awayMs: lateMs }, false);
  try {
    const data = await fetchState();
    if (gen !== pollGen) return;
    document.getElementById("demo-banner").hidden = !data.demo;
    showMachineStatus(data.hosts);
    reportLoad(data);
    if (data.hosts.length) {
      hostsData = data.hosts;
      if (!hostsData.some((h) => h.label === currentHost))
        currentHost = hostsData[0].label;
      // One shared office per host: every project's agents work in the same room.
      for (const h of data.hosts)
        syncRoom(ensureRoom(h, h.label, (h.agents || []).length), {
          ...h,
          agents: expandTeams(h),
        });
      checkAlerts(data.hosts);
      if (selected && !findEnt(selected.key)) selected = null;
      for (const r of rooms.values()) r.el.hidden = r.hostLabel !== currentHost;
      if (firstLoad) resize();
      renderHosts();
      renderSidebar();
      firstLoad = false;
    }
  } catch (err) {
    console.warn("poll failed", err);
  }
  if (gen === pollGen) {
    pollScheduledAt = Date.now();
    pollTimer = setTimeout(poll, POLL_MS);
  }
}

// Coming back to the page: its sockets may be dead without the client knowing (Safari closes
// a background tab's silently). Reconnect or check them, and refresh right away instead of
// waiting for a request on a dead socket to time out. Wall-clock time, because it keeps
// counting while the computer sleeps.
let hiddenAt = document.hidden ? Date.now() : null;
let lastResetAt = -Infinity;
function wake({ awayMs = 0, forced = false }, pollNow = true) {
  const action = wakeAction({
    awayMs,
    forced,
    sinceResetMs: Date.now() - lastResetAt,
  });
  if (action === "reset") {
    lastResetAt = Date.now();
    resetConnections();
  } else if (action === "verify") verifyConnections();
  if (pollNow && action !== "none") poll();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const awayMs = hiddenAt === null ? 0 : Date.now() - hiddenAt;
  hiddenAt = null;
  wake({ awayMs });
});
// Restored from the back/forward cache: every socket was closed while the page was frozen.
window.addEventListener("pageshow", (ev) => {
  if (ev.persisted) wake({ forced: true });
});
window.addEventListener("online", () => wake({ forced: true }));
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const r of rooms.values()) {
    update(r, dt);
    if (!r.el.hidden) render(r, now);
  }
  requestAnimationFrame(frame);
}
setInterval(renderSidebar, 30000);
poll();
requestAnimationFrame(frame);
