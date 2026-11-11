// Invented agents shown until a machine is added, so a first visit shows every part of
// the office: work at desks, a review team, someone waiting on you, finished work, the lounge.
import type { HostState } from "./hosts.ts";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

type Seed = [
  id: string,
  workspace: string,
  prompt: string,
  role: string,
  state: string,
  project: string,
  extra?: Record<string, unknown>,
];

const SEEDS: Seed[] = [
  [
    "a1c0001",
    "Review PR #142 checkout refactor",
    "/review https://github.com/acme/shop/pull/142",
    "pr-review",
    "idle",
    "shop",
    {
      subagents: [
        "Correctness reviewer",
        "Security reviewer",
        "Test coverage reviewer",
      ].map((d, i) => ({
        id: `rv${i}`,
        description: d,
        type: "pr-reviewer",
        active: true,
        lastAt: ago(1),
      })),
    },
  ],
  [
    "a1c0002",
    "PR Orchestrator",
    "Check my PRs with open comments and fix them",
    "orchestrator",
    "idle",
    "shop",
    {
      subagents: [
        {
          id: "or0",
          description: "Fix lint findings on #139",
          type: "general-purpose",
          active: true,
          lastAt: ago(2),
        },
      ],
    },
  ],
  [
    "a1c0003",
    "Migrate orders to the new queue",
    "Implement the migration of orders to the FIFO queue",
    "build",
    "working",
    "shop",
  ],
  [
    "a1c0004",
    "Add dark mode to settings",
    "Implement dark mode for the settings page",
    "build",
    "working",
    "web",
  ],
  [
    "a1c0005",
    "Why do EU payments fail",
    "Investigate why payments fail for EU cards",
    "investigate",
    "working",
    "shop",
  ],
  [
    "a1c0006",
    "Rotate staging credentials",
    "Rotate the staging database credentials",
    "ops",
    "needs_input",
    "infra",
    {
      pending: [
        {
          id: "p1",
          kind: "tool",
          toolName: "Bash",
          title: "Run rotate-credentials.sh --stage staging",
        },
      ],
    },
  ],
  [
    "a1c0007",
    "Weekly dependency bump",
    "Bump dependencies and open a PR",
    "scheduler",
    "review",
    "web",
    { scheduleName: "Monday dependency bump" },
  ],
  [
    "a1c0008",
    "PR #131 changes requested",
    "PR #131 has changes requested and needs to be brought to a mergeable state",
    "pr-triage",
    "review",
    "shop",
  ],
  [
    "a1c0009",
    "Spec the loyalty programme",
    "/prd loyalty points for repeat customers",
    "plan",
    "review",
    "shop",
  ],
  [
    "a1c0010",
    "Triage new support tickets",
    "We got new tickets assigned yesterday. Triage them",
    "triage",
    "idle",
    "support",
  ],
  [
    "a1c0011",
    "Reply to the vendor about SLAs",
    "Help me reply to this email from the vendor",
    "comms",
    "idle",
    "support",
  ],
  [
    "a1c0012",
    "Estimate the monorepo move",
    "Estimate the effort to move to a monorepo",
    "plan",
    "idle",
    "web",
  ],
  [
    "a1c0013",
    "Drain the notifications DLQ",
    "Can you drain the notifications DLQ?",
    "ops",
    "idle",
    "infra",
  ],
  [
    "a1c0014",
    "Find the slow search query",
    "Find out why search is slow since Tuesday",
    "investigate",
    "idle",
    "web",
  ],
  [
    "a1c0015",
    "Fix flaky checkout test",
    "Investigate the flaky checkout test",
    "investigate",
    "idle",
    "shop",
  ],
  [
    "a1c0016",
    "Clean up feature flags",
    "Clean up old feature flags",
    "ops",
    "asleep",
    "web",
  ],
  [
    "a1c0017",
    "Draft release notes v2.4",
    "Draft the release notes for v2.4",
    "comms",
    "asleep",
    "web",
  ],
];

export function demoHost(): HostState {
  const agents = SEEDS.map(
    ([id, workspace, prompt, role, state, project, extra = {}], i) => ({
      id: id + "-demo",
      shortId: id,
      name: prompt,
      status:
        state === "working"
          ? "running"
          : state === "asleep"
            ? "closed"
            : "idle",
      state,
      attentionReason:
        state === "needs_input"
          ? "permission"
          : state === "review"
            ? "finished"
            : null,
      pending: [],
      provider: "claude/claude-opus",
      cwd: `/home/dev/${project}`,
      project,
      workspaceId: `wks_${id}`,
      workspace,
      workspaceLabels: [],
      labels: { role },
      parentId: null,
      scheduleId: role === "scheduler" ? "sch_demo" : null,
      scheduleName: null,
      createdAt: ago(600 + i * 30),
      lastActivityAt: ago(3 + i * 7),
      lastUserMessageAt: ago(5 + i * 7),
      subagents: [],
      ...extra,
    })
  );
  return {
    label: "Demo",
    ok: true,
    error: null,
    hostname: "demo",
    agents,
    labelColors: {},
  };
}
