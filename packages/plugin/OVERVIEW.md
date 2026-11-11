Feeds the Scranton page: a pixel-art office that shows which of your agents are working, idle, waiting on you or ready for review, and which sessions are running teams of subagents.

The plugin adds one read-only RPC, `office.snapshot`, which the page calls through your daemon's pairing link. It also gives every session a `role` label (orchestrator, triage, pr-triage, pr-review, build, investigate, ops, plan, comms, scheduler) from its title, first prompt and the skills it used. A role you set by hand is never changed.

Add your own role patterns, or turn tagging off, in `<PASEO_HOME>/scranton/roles.json`:

```json
{
  "autoTag": true,
  "rules": [{ "role": "investigate", "strong": "my-debug-skill" }]
}
```
