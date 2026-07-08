# Capricorn Growth OS

Wall-dashboard / kiosk system for Capricorn Financial Group: five screens (Daily Run Chase, Office
Run Chase, Adviser League, Funnel Health, Market Momentum) rendered from the Capricorn data lake,
designed for 1920×1080 office TVs and an authenticated browser dashboard.

Built from Capricorn's signed-off strawman screens; visual language: light background, white cards,
navy header, Inter, colour only for meaning — *"Formula One mission control designed by Apple"*.

## Architecture

```
┌────────────────────────── Azure App Service (Linux, Node 22) ──────────────────────────┐
│  Fastify (src/)                                                                        │
│    /dashboard        SPA shell — Entra Easy Auth (Capricorn users sign in as guests)   │
│    /screens?k=<tok>  SPA shell — kiosk mode, Easy-Auth-excluded, shared-token gated    │
│    /api/reporting/*  dataset JSON (Easy Auth)      ┐ same dataset registry             │
│    /api/kiosk?dataset=…&k=<tok>  dataset JSON      ┘ (src/services/reporting/datasets) │
│    /healthz, /healthz/lake  anonymous probes                                           │
│                                                                                        │
│  React 18 + Vite + ECharts SPA (web/) → ONE inlined index.html (vite-plugin-singlefile;│
│  Easy Auth excludedPaths are exact-match only, so the kiosk shell makes zero extra     │
│  requests and the kiosk API is one exact path)                                         │
└───────────────────────────────┬────────────────────────────────────────────────────────┘
                                │ mssql pool, azure-active-directory-default
                                │ (system-assigned MI in prod, az-cli credential locally)
                     Fabric SQL endpoint — lakehouse GAGold_Capricorn
                     (workspace GlobalAnalyticsShare, rebuilt nightly ~03:15 UTC)
```

- **Pacing model** ([src/services/reporting/pacing.ts](src/services/reporting/pacing.ts)): the lake
  is day-grained, so the run chase is **month-to-date vs monthly targets** (daily target × working
  days), measured through the latest complete day ("Data as of …"). If an intraday feed ever
  exists, it plugs into `PacingContext` — pages don't know the cadence.
- **Targets & office mapping are config, not data**:
  [src/domain/targets.ts](src/domain/targets.ts) (seeded from the strawman numbers — placeholders
  pending Capricorn's real targets) and [src/domain/offices.ts](src/domain/offices.ts)
  (adviser username → office; unmapped advisers surface as "Unassigned" by design).
- **No app database.** Everything is computed on read from the lake with a short in-memory cache
  (~45s), so N wall TVs cost ~one Fabric query set per dataset per cache window.

## Metric definitions (verified against the live lake, 2026-07-06)

| KPI | Source |
|---|---|
| Leads | `mortgagecase` by `LeadDate`, `COUNT(DISTINCT LeadId)` |
| Applications | `mortgagecase` by `WrittenDate`, `COUNT(*)` (per product) |
| Protection Referrals | `crosssellreferral` by `CreatedDate` (excl. adviser-declined/errored) |
| Protection Sales | `protectioncase` by `WrittenDate` |
| Offers (funnel) | `mortgagecase.OfferIssueDate` |
| Est. Revenue | `COALESCE(NetCommission, ProductCommission) + ClientFeeAmount` — **indicative** |

Data-source notes discovered during reconciliation:

- `mortgagecase.ReferredToProtectionYN` / `ProtectionReferralDate` are **unpopulated** for
  Capricorn — the cross-sell fact is the referral source of truth.
- Workflow **meeting/DIP dates went dark after April 2026**, so the funnel's second stage is
  **Offers** (`OfferIssueDate`, current and populated), not Meetings.
- `crosssellreferral.CaseID` does not resolve against the exported case tables, so
  "referred vs not referred" (donut, REFER NOW queue) is a same-window **flow proxy**
  (referrals made vs applications written), labelled indicative on-screen.
- 2026-07-01 carries ~4,100 bulk-migrated leads (platform migration artifact) — July's lead chase
  and the CALL NOW queue are inflated until that washes through.

## Develop

```bash
az login                      # an account with read access to the GlobalAnalyticsShare workspace
cp .env.example .env          # defaults are correct; set DEV_USER_EMAIL
set -a; source .env; set +a
npm install && npm --prefix web install
npm run dev                   # Fastify on :3000 (tsx watch)
npm run dev:web               # Vite dev server for the SPA (proxies /api)
```

Verify: `npm test` (pure query builders + pace math), then
`curl localhost:3000/healthz/lake` and `curl localhost:3000/api/reporting/meta`.

Production build: `npm run build:all`, then `node dist/index.js` and open
`http://localhost:3000/screens` (set `REPORTING_KIOSK_TOKEN` to test the kiosk path).

## Deploy

See [docs/deployment.md](docs/deployment.md). TL;DR: `main.bicep` provisions plan + app + Easy Auth
+ Key Vault; the app's managed identity must be granted **Viewer on the Fabric workspace**
(`/healthz/lake` proves it); ship code with `scripts/deployment/deploy-manual.sh` until the GitHub
Actions workflow is activated.

## Wall TVs

Point each TV's browser at:

```
https://<app>/screens?k=<kiosk-token>                 # rotate all five screens
https://<app>/screens?k=<kiosk-token>&pages=daily     # pin one screen
https://<app>/screens?k=<kiosk-token>&pages=daily,funnel
```

Rotation dwell = `REPORTING_CYCLE_SECONDS` (20s), data poll = `REPORTING_REFRESH_SECONDS` (60s).

## Open items for Capricorn

1. **Real targets** — daily targets per KPI, per office (`src/domain/targets.ts` holds the
   strawman placeholders, clearly labelled on-screen). An upload mechanism exists (dashboard
   "Targets" tab, `docs/deployment.md` § Weekly targets upload) — disabled until Arman's and a
   backup's admin email addresses are confirmed and set.
2. **Adviser → office mapping** — a username → office list (`src/domain/offices.ts`); until then
   the office screens show "Unassigned".
3. **Revenue definition** — which commission columns count as revenue (screens label revenue
   figures *indicative* until confirmed).
4. **Application definition** — per-product `COUNT(*)` vs per-lead; whether `NotProceedingYN`
   cases should be excluded.
5. **Logo asset** — the header ships a placeholder ♑ mark.
6. **Timezone** — one Europe/London business day is used for all offices (HK/Singapore/Shanghai
   local days would need per-office day windows).
