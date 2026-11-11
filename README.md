# Scranton

A pixel-art office for your [Paseo](https://paseo.sh) agents. See at a glance who is working, who is idle, who is waiting on you and whose work is ready for review — across every machine you run Paseo on.

- **Desks** — agents that are running sit at a desk and type.
- **Needs you** — agents waiting for a permission or an answer stand on the red carpet.
- **Ready to review** — finished work you have not looked at yet waits on the green carpet.
- **Lounge** — idle agents wander; closed sessions nap on the couch (toggle **Show closed**).
- **Meeting rooms and booths** — a session that hands work to subagents becomes a manager, and its team moves into a meeting room (3+ helpers) or a booth (1–2).
- **Uniforms** — every session gets a role (build, investigate, ops, pr-review, …) and dresses for it.

Open the page with no machines added and it shows demo data.

## How it works

```
your browser                                   each machine running Paseo
┌──────────────────────────┐   end-to-end      ┌────────────────────────────────┐
│ static page (this repo)  │   encrypted via   │ Paseo daemon                   │
│ pairing links kept in    │ ───────────────►  │  └─ Scranton plugin        │
│ this browser's storage   │  Paseo's relay    │      • office.snapshot (read)  │
└──────────────────────────┘                   │      • role labels             │
                                               └────────────────────────────────┘
```

The page is static. It talks to each machine the same way the Paseo app does: through a pairing link, over Paseo's relay, encrypted end to end. The plugin answers one read-only call, `office.snapshot`, and labels sessions with a role.

## Use it

1. **Install the plugin** on every machine you want to see (Paseo 0.15 or newer):

   ```bash
   git clone https://github.com/Lab061/scranton.git
   cd scranton && npm install
   node packages/plugin/scripts/dev.mjs 127.0.0.1:6767 install "$PWD/packages/plugin"
   ```

   If the plugin shows as `disabled`, plugins are off for that daemon: run `paseo daemon config set pluginsEnabled true` and restart Paseo once.

2. **Get a pairing link** on that machine: `paseo pair` (or **Settings → Pair a device** in the Paseo app).
3. **Open the page**, click **Machines**, give the machine a name and paste the link.

### What a pairing link gives away

A pairing link gives full control of that Paseo daemon — the same access the Paseo app has. The page keeps links only in your browser's `localStorage`, uses them only to open an encrypted connection through Paseo's relay, and never sends them to the website. The built page carries a Content Security Policy that only allows connections to itself and `wss://relay.paseo.sh`. Remove a machine in **Machines** to forget its link. If you would rather not trust a hosted copy, run the page yourself (below).

## Roles

The plugin labels each session once, after its first turn, with `role=<name>` and `role-source=auto`, using the session's title, first prompt and the skills or commands it used. It never changes a role that is already set, so a role you set by hand always wins:

```bash
paseo agent update <agent-id> --label role=investigate
```

Add patterns for your own skills, or turn tagging off on a machine, in `<PASEO_HOME>/scranton/roles.json` (`~/.paseo/scranton/roles.json` by default):

```json
{
  "autoTag": true,
  "rules": [
    { "role": "investigate", "strong": "my-debug-skill|my-incident-skill" },
    { "role": "ops", "weak": "\\bfailover\\b" },
    { "role": "release", "strong": "cut a release" }
  ]
}
```

`strong` matches a skill, slash command or phrase that only that role uses; `weak` matches wording that suggests it. Patterns for a built-in role widen it; a new role name adds a role. Check your rules against roles you set by hand with `node packages/plugin/scripts/evaluate.ts` on that machine.

## Develop

Requires Node 24 (`nvm use`).

```bash
npm install
npm run dev          # the page on http://localhost:5173 (demo data until you add a machine)
npm test             # plugin tests
npm run typecheck
npm run format:fix
```

Work on the plugin against a running daemon:

```bash
cd packages/plugin
node scripts/dev.mjs 127.0.0.1:6767 install "$PWD"   # first time
node scripts/dev.mjs 127.0.0.1:6767 reload           # after a change
node scripts/dev.mjs 127.0.0.1:6767 call office.snapshot
node scripts/dev.mjs 127.0.0.1:6767 logs
```

The first argument is anything `paseo --host` accepts, including a pairing link.

## Deploy

The page deploys as a static site (S3 + CloudFront) with [SST v3](https://sst.dev). The hosted copy lives at **https://scranton.lab061.com.br**.

```bash
npx sst deploy --stage testing                                     # CloudFront URL
DOMAIN=scranton.example.com npx sst deploy --stage production      # https://scranton.example.com
```

With `DOMAIN` set, production serves that domain and other stages serve `<stage>.<DOMAIN>`. A Route 53 hosted zone covering the domain must exist in the deploying account.

Each stage also creates `github-actions-scranton-<stage>`, the IAM role GitHub Actions assumes through OIDC. Only a job running in the matching GitHub environment of this repository can assume it. Because a deploy creates the role CI uses, the first deploy of each stage runs from a laptop with admin credentials.

GitHub Actions deploys `testing` on every push to `master` and `production` when a release is published. Configure:

| Kind                | Name           | Value                                                    |
| ------------------- | -------------- | -------------------------------------------------------- |
| Environment secret  | `AWS_ROLE_ARN` | the stage's `deployRoleArn` output, in each environment  |
| Repository variable | `AWS_REGION`   | e.g. `us-east-1`                                         |
| Repository variable | `DOMAIN`       | the site's domain; leave unset to use the CloudFront URL |

## Repository layout

```
packages/plugin/   Paseo plugin: office.snapshot RPC and role labels
packages/web/      the page (Vite): office canvas, machines, demo data
infra/             SST: static site and the GitHub deploy role
docs/              architecture notes
```

## License

[MIT](LICENSE)
