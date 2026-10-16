# Expense

The AmberX Expense Tracker as its own app — https://expenses.amberxai.com.

This is the studio's `expenses` module **peeled** out of https://github.com/MossesX/studioX
with `npm run peel expenses --with accounts` (banner, no navigation menus; the `accounts`
module rides along for sign-in), plus the deploy overlay from
`packages/studio/deploy/expenses/` (session gate `proxy.ts`, `app/login`, Dockerfile, compose).
`@axf/core` is vendored under `vendor/axf-core`, so the tree builds on its own.

**Source of truth is studioX.** Change the module there and re-run
`packages/studio/deploy/expenses/build.sh`; this repository is a snapshot of that output
(`peel.manifest.json` records the framework version and closure).

```
npm install
npm run typecheck
npm run dev            # http://localhost:3200/expenses

docker build -t amberx-expenses .
docker compose up -d   # expects Coolify's `coolify` Traefik network and the amberx-studio-data volume
```

Runtime data lives in the mounted `/data` volume (accounts, ledger, pay schedule, saves/reports);
nothing in this repository holds credentials or ledger data.
