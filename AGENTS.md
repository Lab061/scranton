# AGENTS.md

Scranton: a static pixel-art page that shows Paseo agents across machines, fed by a Paseo plugin. Public repository — never commit secrets, pairing links, personal role rules (`roles.json`) or real session data.

## Layout

- `packages/plugin/` — Paseo plugin. Entry `index.server.ts`; modules must live in `server/` or `shared/` or Paseo refuses to load them. `office.snapshot` RPC in `server/snapshot.ts`; role labels in `server/roles/`.
- `packages/web/` — Vite page. `src/office.js` draws the office (plain JS, not typechecked); `src/hosts.ts` manages pairing links and daemon clients; `src/demo.ts` is invented data for visitors with no machines.
- `infra/web.ts` — SST static site; domain from `DOMAIN`. `infra/github.ts` — the OIDC role CI deploys with.
- `docs/ARCHITECTURE.md` — data flow, states, role scoring. Update it when those change.

## Commands

```bash
npm install
npm run dev            # page with demo data
npm test               # plugin unit tests (vitest)
npm run typecheck
npm run format:fix
node packages/plugin/scripts/dev.mjs <connection> install|reload|call|logs
```

## Rules

- The snapshot is read-only. The only write the plugin makes is the `role`/`role-source` label, and only when no role is set.
- The page must keep working with no machines (demo data) and with unreachable machines (last good snapshot plus an error).
- Keep the Content Security Policy in `packages/web/vite.config.ts` tight: new network destinations need a reason.
- Sprites and the office are drawn in code. Do not add art, names or logos from existing games or TV shows.
