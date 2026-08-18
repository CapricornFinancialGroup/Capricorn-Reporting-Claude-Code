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
                     (workspace GlobalAnalyticsShare, reloaded 5× daily (~07:50, 11:10, 14:15, 17:10, 20:10 UTC — verified 2026-08-04))
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

## Metric definitions

Every figure below was compared against the platform stored procedure that defines it and quantified
on the live lake (full review 2026-07-30). Where ours and the platform's differ, the note says so.

| KPI | Source |
|---|---|
| New Client Leads | `mortgagecase` by `LeadDate`, `COUNT(DISTINCT PrimaryClientKey)`, **restricted to clients whose first case this is** (across mortgage/protection/GI). A lead is a NEW CLIENT, not a new case — Capricorn's ruling 2026-08-17. Was `COUNT(DISTINCT LeadId)` over every case until then |
| Existing Client Cases | `mortgagecase` by `LeadDate`, `COUNT(*)` where the client's first case predates this one — remortgages, repeat clients, second applications. The other half of the old "Leads". **No target**, and since 2026-08-18 **not shown on the run chase** — Capricorn ruled the chase is new clients only ("just be Client Added ie. New Client only", Kyle). Still measured, still in the payload, still reported on Funnel Health |
| Mortgages Written | `mortgagecase` by **`WorkflowStatusPreOfferProcessingDate`** (status 70 — the platform's own "written"), `COUNT(*)` per product. Labelled "Applications" until 2026-07-28 — it counts business **written**, not applications submitted to a lender |
| Protection Opportunities | `protectioncase` by `CreatedDate` — protection cases OPENED. Was `crosssellreferral` (PaymentShield quotes + currency exchange, not protection) until 2026-07-30 |
| Protection Sales | `protectioncase` by `WrittenDate` |
| Offers (funnel) | `mortgagecase.`**`WorkflowStatusPostOfferProcessingDate`** (status 100 — the platform's "offer issued"). Was `OfferIssueDate`, which is 97% empty and understated offers 8× |
| Weekly Written | **commission only**: `mortgagecase COALESCE(NetCommission, ProductCommission)` by status-70 date + `protectioncase.ProductCommission` by `WrittenDate` — the basis Capricorn's Total Written report uses. Client fees carried separately, never folded in |
| Est. Revenue (League) | Weekly Written's mortgage leg **plus** `ClientFeeAmount` — deliberately wider, and over the current week to date rather than the last complete week |
| Total Lending | `SUM(MortgageValue)` — loan value, never "written" |

**Every screen defaults to a different window, and each now prints its own dates on the tile**
(Kyle 2026-07-28 read Momentum's last-complete-week tiles as current-week and reconciled them
against a report sharing none of their days):

| Screen | Default window |
|---|---|
| Daily / Office Run Chase | current Sat–Fri week to date (+ latest trading day) |
| Adviser League | current Sat–Fri week to date |
| Funnel Health | month to date — **dashboard only, off the wall rotation since 2026-08-18** |
| Market Momentum | **last complete Sat–Fri week** (+ rolling 13-week trend) |

Data-source notes discovered during reconciliation:

- `mortgagecase.ReferredToProtectionYN` / `ProtectionReferralDate` are **unpopulated** for
  Capricorn — the cross-sell fact is the referral source of truth.
- Workflow **meeting/DIP dates went dark after April 2026**, so the funnel's second stage is
  **Offers** (`OfferIssueDate`, current and populated), not Meetings.
- **RESOLVED 2026-07-30 — "Protection Referrals" is now "Protection Opportunities".** The old KPI read
  `crosssellreferral`, which is not protection: the Gold load unions PaymentShield referrals,
  PaymentShield **quotes** and SmartCurrencyExchange, and for Capricorn in July it held 112 home-insurance
  *quote* events plus 8 currency referrals — zero protection referrals. It reported 110 of those as
  July's protection referrals, and went unnoticed because ~24/wk sat next to the 25/wk target.
  - The platform's Referrals report keys on `tblLead.InsuranceAdviser`. Capricorn does not use that
    workflow — it resolves on 3 of 1,839 written cases and 0 in W30 — so **their own in-platform
    Referrals report is near-empty too**, and adding the field to the share would deliver an empty
    column. Not a pipeline gap; a behaviour they don't record.
  - The KPI now counts protection cases OPENED (`protectioncase.CreatedDate`): stable at 70/51/42/46/49
    per week (w/c 22 Jun → 20 Jul), properly dated, so the run chase still works. Renamed on screen so
    it can't be mistaken for a referral.
  - ⚠ **The 5/day, 25/week target was set against the old wrong number** and needs Kyle's ruling;
    opportunities run ~48/wk. Separately, protection cases WRITTEN ran 4 in W30 and 52 in July against
    the same 25/week target — a real gap the old referral figure was masking.
- ⚠ **Referral-rate denominator differs from the platform.** Ours is referrals ÷ mortgages written;
  the platform's is referrals ÷ mortgage **offers**, deduplicated to unique clients
  (`GetConversionRateForInsuranceReferrals`). W30: 174 written vs 115 offers, so the two bases give
  materially different rates. Left as-is pending the numerator fix above — correcting the denominator
  alone would just be a different wrong number.
- **Protection Sales has three competing definitions.** Ours: `protectioncase` by `WrittenDate`
  (52 in July). The platform's Protection report (`usp_GetInsuranceProductReport`) treats statuses
  **60, 65 and 70** as written; the Total Written Report's insurance leg uses **65 only** (20 in
  July). Needs one ruling from Kyle.
- `crosssellreferral.CaseID` does not resolve against the exported case tables, so
  "referred vs not referred" (donut, REFER NOW queue) is a same-window **flow proxy**
  (referrals made vs applications written), labelled indicative on-screen.
- **RESOLVED 2026-08-18 — the lead "gap" is the report's RUN TIME, not its definition.** Kyle
  compared three figures and read them as a three-way discrepancy: "New Client Leads 136 vs. 175?
  Also, our Daily Report had 116". They are three different things, and once measured at the same
  moment the two systems agree to within 2 leads.
  - **136** = new-client leads on Mon 17 Aug (a full day). **176** = the same measure week to date,
    Sat 15 – Mon 17, which is what the office leaderboard is labelled. **116** = Capricorn's Daily
    Lead Report for Monday alone, run at 17:01. Their own report also prints **156** WTD — the
    number that compares with our 176. The gap is the same 20 on both, i.e. it is all in one day.
  - **The weekend reconciles exactly.** Ours: Sat 38 + Sun 2 = 40. Theirs: 156 − 116 = 40. Their
    report groups Sat/Sun into Monday and runs Mon–Fri; that grouping is not the discrepancy.
  - **The 20 is leads entered after their report ran.** By `_etl_created` load batch, Monday's
    new clients arrive 1 · 26 · 37 · 50 · 22 across the 07:50/11:10/14:15/17:10/20:10 UTC loads
    (+2 the next morning). Cumulative by the 17:10 UTC load = **114**, against their **116** taken
    at 16:01 UTC — 2 apart, ours measured slightly later. The last load adds **22**, which is the
    whole gap. Their 17:00 send time sits in the middle of Capricorn's busiest lead hours.
  - So the answer to "how do we narrow this gap" is a same-cut comparison, not a definition change:
    compare their WTD to ours (156 vs 176), or run their report after the day closes. Worth knowing
    too: the two halves of their OWN report disagree by 4 on the same day (patch table 116 today /
    156 WTD, team-leader table 112 / 153), so there is a floor to how close any two cuts get.
  - Their leads target rule, from the same report: **2 leads per adviser per working day, Mon–Fri,
    weekend rolled into Monday** — 62 active advisers → 620/wk. Ours is 633/wk (⚠ see below: set by
    headcount against the OLD, wider lead definition, so it is high on two counts now).
- **RESOLVED 2026-08-17 — a lead is a NEW CLIENT, not a new case.** The board read 378 leads for
  Sat 8 – Wed 12 Aug against 291 on the in-platform report the team ran at 17:00 on the 12th.
  Capricorn's ruling: "a new lead is actually a new client added to the system". Their report is
  `usp_LeadsReport` → `usp_GetLeadsByUserId_LeadFlow`, whose own header states the basis — *"Date
  filtering is on `tblClient.AddDate` [rather than `tblLead.Created`]"* — so it dates a lead by when
  the CLIENT record was created and never sees a lead raised for a pre-existing client. On the new
  basis that week is **315 new clients + 61 existing-client cases**.
  - ⚠ **We cannot key on their field.** `client.AddedToSystemDate` in the share is a one-off bulk
    load of 225,246 rows on 22 Apr 2026 (latest value 21 Apr); the 128,850 rows that have arrived
    since 8 Jul carry **NULL**. Of that week's leads, 335 are NULL and the 43 populated all predate
    the window. Getting it populated on incremental loads is the ask that would allow literal
    alignment. Until then "new" is derived as the client's **first case across mortgage, protection
    and GI** (history to 2009, so first-appearance is well-founded). Client identity is
    `mortgagecase.PrimaryClientKey` — never NULL across all 270,001 live cases, agreeing with
    `mortgagecaseclient` on all 386 rows of the reference week, resolving 100% into `dbo.client`.
  - Two differences to their report remain BY DESIGN: it is scoped to the advisers whoever ran it can
    see (the board is group-wide, both entities — org 411 was 17 of that week), and it requires a live
    non-external product of the chosen `FinanceTypeId`.
  - ⚠ **The 633/wk leads target is now on the wrong basis** — set by headcount against the old wider
    count, it runs ~16% above this one. Left unchanged rather than quietly rebased; flagged on-screen,
    awaiting Kyle. `existingCases` ships untargeted, and is rendered as *tracked* (no pace line, no
    status pill) precisely because `paceStatus`/`chaseStatus` band "expected 0, actual > 0" as AHEAD.
  - The earlier "Leads verified sound (2026-07-30): 662 vs 655, under 1% apart" note was comparing a
    client-deduplicated count on the SAME date basis, not this report — the `AddDate` basis cannot
    land within 1%. Do not cite it as evidence that leads reconcile.
- 2026-07-01 carries ~4,100 bulk-migrated leads (platform migration artifact) — July's lead chase
  and the CALL NOW queue are inflated until that washes through. The exclusion
  ([domain/data-quality.ts](src/domain/data-quality.ts)) applies to **`LeadDate`-keyed metrics only**:
  it was over-applied to written/application/revenue queries until 2026-07-29, silently deleting 16
  written cases worth £19,592 of July commission.
- `vw_total_written_by_product` is **loan value / policy amount, not commission**, despite backing a
  report of the same name. `MortgageWritten` equals `SUM(mortgagecase.MortgageValue)` to the penny on
  six separate days (verified 2026-07-29). It is never the written-commission source.
- **Input lag: a just-closed week is not final.** Cases are entered a mean 6.0 days after their
  `WrittenDate` (only ~36% same-day; ~28% take 8–30 days; 22% of written £ arrives 8+ days late).
  W30 read £266.3k / 133 written on 28 Jul and £299.6k / 149 on 29 Jul. `WrittenDate`-keyed figures
  inside `INPUT_LAG_SETTLE_DAYS` of their week end are flagged `provisional` on screen.
- **RESOLVED 2026-07-29 — "written" means the status-70 date, not `WrittenDate`.** Capricorn's Total
  Written Report is `usp_GetTotalProductReport` (platform repo, `Occfinance.Database`). It keys on the
  date a product entered status **'Pre-offer Processing'** (FinanceStatusId 70), exposed in the lake as
  `mortgagecase.WorkflowStatusPreOfferProcessingDate`. `mortgagecase.WrittenDate` is a different date —
  the Gold load builds it as `COALESCE(SubmissionDate, <status-70 date>)`, so `SubmissionDate` wins and
  usually sits 1–21 days earlier. Every mortgage "written" measure now keys on status 70
  ([domain/data-quality.ts](src/domain/data-quality.ts) `MORTGAGE_WRITTEN_DATE`), which reconciles:
  25–27 Jul org 486 = £110,689 against Kyle's £112,083 report run at 09:41 on the 28th, with Albano
  Toska, Ross Culley, Toby Scott-Mason and Jacob Furniss matching to the penny.
  - Accepted trade-off: 112 of 1,745 recent cases (6.4%, £178k) have no status-70 date and are
    excluded — the platform report inner-joins the status, so it excludes them too.
  - Weekly *totals* barely move (13-week mean £290k → £292k, 141 → 140 cases/wk); what changes is
    **which week** a case lands in. Short windows shift a lot, which is why a 4-day comparison looked
    like a 2× error and a 7-day one looked close.
  - Protection stays on `WrittenDate`: its status-65 equivalent is populated for only ~20% of cases,
    and the two agree exactly where both exist.
- ⚠ **OPEN — protection adviser attribution.** The platform report credits protection to
  `tblLead.InsuranceAdviser` and splits commission via `tblSplitCommission`; the lake carries one
  `PrimaryAdviserUserAccountKey` per case. Totals are close (£18.9k vs £22.7k for 25–28 Jul) but
  per-adviser protection credit will not match until the share carries the insurance-adviser and
  split-commission attribution.

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
   the office screens show "Unassigned". Currently **one adviser outstanding: Denisa Ahmetaj**
   (`denisa.ahmetaj@capricornfinancialmortgages.co.uk`, 66 cases back to 2015 — a real adviser
   simply absent from the Datarails mapping export, not a new joiner). Dubai was retired
   2026-08-18 on Kyle's instruction.
3. **Revenue definition** — which commission columns count as revenue (screens label revenue
   figures *indicative* until confirmed).
4. **Application definition** — per-product `COUNT(*)` vs per-lead; whether `NotProceedingYN`
   cases should be excluded.
5. **Logo asset** — the header ships a placeholder ♑ mark.
6. **Timezone** — one Europe/London business day is used for all offices (HK/Singapore/Shanghai
   local days would need per-office day windows).
