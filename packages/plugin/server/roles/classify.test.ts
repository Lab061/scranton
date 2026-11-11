import { describe, expect, it } from "vitest";
import {
  BASE_RULES,
  classify,
  mergeRules,
  signalsFromLogs,
} from "./classify.ts";

describe("classify", () => {
  it.each([
    [{ prompt: "/review https://github.com/acme/api/pull/12" }, "pr-review"],
    [
      {
        prompt:
          "PR https://github.com/acme/api/pull/9 has changes requested and needs to be brought to a mergeable state",
      },
      "pr-triage",
    ],
    [
      {
        workspace: "PR Orchestrator",
        prompt: "Check my PRs with open comments",
      },
      "orchestrator",
    ],
    [
      { prompt: "We got new stories assigned on jira yesterday. Triage them" },
      "triage",
    ],
    [{ prompt: "Implement the user stories for the billing page" }, "build"],
    [
      {
        workspace: "Measure effort to move projects npm to pnpm",
        prompt: "Measure the effort",
      },
      "plan",
    ],
    [
      { prompt: "Investigate why checkout fails for EU customers" },
      "investigate",
    ],
    [
      { workspace: "Drain OpenSearch DLQ", prompt: "Can you drain the DLQ?" },
      "ops",
    ],
    [{ prompt: "Help me reply to this email from the client" }, "comms"],
  ])("%j -> %s", (signals, role) => {
    expect(classify(signals).role).toBe(role);
  });

  it("tags scheduled runs as scheduler regardless of wording", () => {
    expect(
      classify({ prompt: "Investigate the build", scheduled: true }).role
    ).toBe("scheduler");
  });

  it("returns no role when nothing matches", () => {
    expect(classify({ prompt: "hello" }).role).toBeNull();
  });

  it("weights the opening ask over context pasted below it", () => {
    const prompt =
      "Reply to this customer.\n" +
      "x".repeat(500) +
      "\nwe should investigate the root cause";
    expect(classify({ prompt }).role).toBe("comms");
  });

  it("does not read 'orchestrator' in prose as the orchestrator role", () => {
    expect(
      classify({
        workspace: "Plan retiring the storefront",
        prompt: "back when we were a channel orchestrator",
      }).role
    ).toBe("plan");
  });
});

describe("mergeRules", () => {
  it("widens a built-in role with custom patterns", () => {
    const rules = mergeRules([{ role: "investigate", strong: "acme-debug" }]);
    expect(classify({ tools: "Skill acme-debug" }, rules).role).toBe(
      "investigate"
    );
    expect(classify({ tools: "Skill acme-debug" }, BASE_RULES).role).toBeNull();
  });

  it("adds new roles", () => {
    const rules = mergeRules([{ role: "release", strong: "cut a release" }]);
    expect(classify({ prompt: "cut a release for v2" }, rules).role).toBe(
      "release"
    );
  });
});

describe("signalsFromLogs", () => {
  it("reads the first prompt, including one sent by another agent", () => {
    const logs =
      "[Message received] Fix PR 4\nmore context\n[Thought] hmm\n[Skill] acme-skill\n[User] later message";
    const s = signalsFromLogs(logs);
    expect(s.prompt).toBe("Fix PR 4\nmore context");
    expect(s.tools).toContain("Skill acme-skill");
    expect(s.tools).not.toContain("later message");
  });
});
