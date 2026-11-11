// Role classifier for Paseo sessions. Pure and dependency-free so the plugin, the
// backfill and the evaluation script share it.

/** Built-in roles. Custom rules may add others; the office gives those a plain coloured shirt. */
export type Role = string;

export interface Signals {
  /** Workspace title Paseo generated for the session, e.g. "Drain OpenSearch DLQ". */
  workspace?: string | null;
  /** Agent title (usually the start of the first prompt). */
  title?: string | null;
  /** First user message. */
  prompt?: string | null;
  /** Skills, slash commands and shell commands the session used, joined. */
  tools?: string | null;
  scheduled?: boolean;
}

export interface Rule {
  role: Role;
  /** Explicit evidence: a skill, slash command or agent type that only this role uses. */
  strong?: RegExp;
  /** Wording that suggests the role. */
  weak?: RegExp;
  /** Match `strong` only against the workspace title and tools, not the prompt (the word is common in prose). */
  strongOutsidePrompt?: boolean;
}

// Generic rules: wording plus public skills and slash commands (Claude Code built-ins, BMad).
// Personal skills go in <PASEO_HOME>/scranton/roles.json (see README). Order breaks ties.
export const BASE_RULES: Rule[] = [
  {
    role: "pr-triage",
    strong:
      /you now own pr\b|review comments on|unresolved (review )?comments|changes requested|mergeable state/i,
    weak: /address (the )?(review|feedback)|open comments/i,
  },
  {
    role: "orchestrator",
    strong: /\borchestrator\b|\bpaseo run\b|fan(ning)? out (agents|sessions)/i,
    strongOutsidePrompt: true,
    weak: /\bmy prs\b.*\b(open comments|comments)\b|check (all )?my prs/i,
  },
  {
    role: "pr-review",
    strong:
      /\/(review|code-review|security-review)\b|pr-reviewer|bmad-code-review|copilot review/i,
    weak: /\breview (this|the|my)? ?(pr|pull request|diff|branch)\b|open prs/i,
  },
  {
    role: "triage",
    strong: /\btriage\b(?! ?the comments)/i,
    weak: /new (stories|tickets|issues)|assigned on jira|backlog grooming/i,
  },
  {
    role: "build",
    strong: /\/(bmad-build|ship|tdd)\b|bmad-build|bmad-agent-dev/i,
    weak: /\b(implement|implementation|refactor|user stories|move .{0,40}endpoint|migrate .{0,60} to |mock data|build (the|a|an))\b/i,
  },
  {
    role: "plan",
    strong:
      /\/(bmad-spec|prd|bmad-prd|bmad-architecture|bmad-ticket)\b|bmad-spec|bmad-architecture/i,
    weak: /\b(plan|planning|spec|estimate|effort|brainstorm|architecture|chat about|thinking about|retir(e|ing))\b/i,
  },
  {
    role: "investigate",
    strong: /debug-prod-issue|incident-investigator/i,
    weak: /\b(investigat\w*|why|find out|figure out|check (if|whether|the last)|confirm|verify|flaky|root cause|look into|record count|display issue|holds?)\b/i,
  },
  {
    role: "ops",
    strong: /release-train|draft-release/i,
    weak: /\b(deploy|whitelist|drain|clean ?up|restart|rotate|scheduled job|cron|dlq|create a (store|bucket|queue)|provision|infra)\b/i,
  },
  {
    role: "comms",
    strong: /\/standup|draft-announcement/i,
    weak: /\b(reply|respond|answer (this|the) (email|message)|draft (a|the) (message|email)|clarify)\b/i,
  },
];

export interface CustomRule {
  role: string;
  strong?: string;
  weak?: string;
  strongOutsidePrompt?: boolean;
}

/** Custom patterns widen the built-in rule for the same role; new roles are appended. */
export function mergeRules(custom: CustomRule[]): Rule[] {
  const rules = BASE_RULES.map((r) => ({ ...r }));
  const join = (a: RegExp | undefined, b: string | undefined) =>
    !b ? a : new RegExp(a ? `(?:${a.source})|(?:${b})` : b, "i");
  for (const c of custom) {
    const existing = rules.find((r) => r.role === c.role);
    if (existing) {
      existing.strong = join(existing.strong, c.strong);
      existing.weak = join(existing.weak, c.weak);
    } else
      rules.push({
        role: c.role,
        strong: join(undefined, c.strong),
        weak: join(undefined, c.weak),
        strongOutsidePrompt: c.strongOutsidePrompt,
      });
  }
  return rules;
}

export interface Verdict {
  role: Role | null;
  scores: Partial<Record<Role, number>>;
}

export function classify(s: Signals, RULES: Rule[] = BASE_RULES): Verdict {
  if (s.scheduled) return { role: "scheduler", scores: { scheduler: 99 } };
  // What the session was started for (its first prompt and the title Paseo summarised it
  // into) outweighs skills it happened to use later on.
  const ws = s.workspace || "";
  // The ask sits at the top of a prompt; pasted context below it (PR bodies, emails) is noise.
  const words = [s.title, (s.prompt || "").slice(0, 400)]
    .filter(Boolean)
    .join("\n");
  const tools = (s.tools || "").slice(0, 8000);
  const scores: Partial<Record<Role, number>> = {};
  for (const rule of RULES) {
    let n = 0;
    if (
      rule.strong &&
      (rule.strong.test(ws) ||
        (!rule.strongOutsidePrompt && rule.strong.test(words)))
    )
      n += 4;
    if (rule.weak && rule.weak.test(ws)) n += 2;
    if (rule.weak && rule.weak.test(words)) n += 2;
    if (rule.strong && rule.strong.test(tools)) n += 1;
    if (n) scores[rule.role] = n;
  }
  let best: Role | null = null;
  for (const rule of RULES) {
    const n = scores[rule.role] || 0;
    if (n > (best ? scores[best] || 0 : 0)) best = rule.role;
  }
  return { role: best, scores };
}

/** Pull signals out of `paseo logs <id>` text: the first [User] block and tool lines. */
export function signalsFromLogs(
  text: string
): Pick<Signals, "prompt" | "tools"> {
  const lines = text.split("\n");
  const prompt: string[] = [];
  const tools: string[] = [];
  let inPrompt = false;
  let seenPrompt = false;
  for (const line of lines) {
    const tag = /^\[([A-Za-z_ .-]+)\]\s?(.*)$/.exec(line);
    if (tag) {
      inPrompt = false;
      // Sessions started by another agent open with "[Message received]" instead of "[User]".
      const opener = tag[1] === "User" || tag[1] === "Message received";
      if (opener && !seenPrompt) {
        seenPrompt = true;
        inPrompt = true;
        prompt.push(tag[2]);
      } else if (!opener && tag[1] !== "Thought")
        tools.push(tag[1] + " " + tag[2].slice(0, 200));
    } else if (inPrompt) prompt.push(line);
  }
  return { prompt: prompt.join("\n").slice(0, 4000), tools: tools.join("\n") };
}
