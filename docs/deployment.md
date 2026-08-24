# Deployment

Production: Azure App Service (Linux, Node 22) in its own resource group, Easy Auth for the
dashboard, shared token for the kiosk, reading the Fabric lakehouse with the app's system-assigned
managed identity. No database.

| | |
|---|---|
| Resource group | `smt-rg-capgrowth-prod` (North Europe) |
| App Service | `smt-capgrowth-app-prod` (plan `smt-capgrowth-plan-prod`, Linux B1) |
| Key Vault | `smt-kv-capgrowth-prod` (secret `capgrowth-kiosk-token`) |
| Data source | Fabric lakehouse `GAGold_Capricorn`, workspace `GlobalAnalyticsShare` (`d578dae6-d186-4ff2-a775-83744a51bbed`) |
| App URL | https://smt-capgrowth-app-prod.azurewebsites.net |

## Provisioning (in order)

### 1. Entra app registration (Easy Auth)

```bash
az ad app create --display-name "Capricorn Growth OS" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://smt-capgrowth-app-prod.azurewebsites.net/.auth/login/aad/callback" \
  --enable-id-token-issuance true
az ad app credential reset --id <appId> --display-name easy-auth --years 2   # note the secret

# REQUIRED — az ad app create makes NO service principal and NO API permissions. Without all three
# of the following, Easy Auth sign-in fails at the callback with AADSTS650056 (Misconfigured app):
az ad sp create --id <appId>                                        # 1. enterprise app / SP
az ad app permission add --id <appId> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope      # 2. Microsoft Graph User.Read (delegated)
az ad app permission admin-consent --id <appId>                     # 3. tenant admin consent (AllPrincipals)
```

Capricorn users authenticate as B2B guests in this tenant — no extra registration config needed.

Restrict who can open the dashboard: set "Assignment required" on the enterprise app and assign a
`Capricorn Growth OS Users` security group (needs Entra ID P1 — present in this tenant). Direct user
assignment works without P1.

> **AADSTS650056 at the callback** = the app is missing Graph `User.Read` and/or tenant admin
> consent (the three commands above). Not a cookie or client-side issue — retrying never helps.
> Fix via the CLI above or the portal: App registration → API permissions → Grant admin consent.

### 2. Resource group + Bicep

```bash
az group create -n smt-rg-capgrowth-prod -l northeurope
az deployment group create -g smt-rg-capgrowth-prod \
  --template-file scripts/infrastructure/main.bicep \
  --parameters entraClientId=<appId> entraClientSecret=<secret> \
               reportingKioskToken=$(openssl rand -hex 24)
```

Note the `appPrincipalId` output — it's needed for step 3.

### 3. Managed identity → Fabric workspace (THE deployment gate)

The app's system-assigned MI must be able to read the lakehouse SQL endpoint. Grant it **Viewer**
on the workspace (Fabric admin action):

- Portal: app.fabric.microsoft.com → `GlobalAnalyticsShare` → Manage access → Add →
  search the MI by app name (`smt-capgrowth-app-prod`) → Viewer.
- Or REST: `POST /v1/admin-or-workspace-api/workspaces/{workspaceId}/roleAssignments` with the MI's
  service-principal objectId.

Preconditions: the Fabric tenant setting **"Service principals can use Fabric APIs"** must allow
the principal (enable for a security group containing the MI if it's restricted).

**Prove it before wiring any TV:** `curl https://<app>/healthz/lake` must return
`{"status":"ok"}`. Until the grant propagates (can take ~15 min) it returns 503 with the login
error text.

### 4. Ship the code

```bash
./scripts/deployment/deploy-manual.sh            # builds, tests, zips, az webapp deploy, smokes
```

CI: `.github/workflows/deploy.yml` is a ready GitHub Actions skeleton (OIDC login); activate per
its header comments once the repo is on its permanent GitHub home.

> **Known quirk:** `az webapp deploy` may report *"site failed to start within 10 mins"* even when
> the deployment succeeded — its startup probe hits `/`, which Easy Auth answers with 401. Trust
> `/healthz` + `/healthz/lake` (both anonymous), not the poller verdict (observed on the first
> production deploy, 2026-07-06).

### 5. Verify

1. `curl https://<app>/healthz` → 200 (anonymous).
2. `curl https://<app>/healthz/lake` → 200 (proves MI → Fabric).
3. Browser `https://<app>/dashboard` → Entra sign-in → screens render.
4. `https://<app>/screens` **without** `?k=` → shell loads, data panel shows the token hint (401).
5. `https://<app>/screens?k=<token>` → rotating wall screens.

## Operations

- **Rotate the kiosk token**: update KV secret `capgrowth-kiosk-token`, restart the app, update TV
  URLs.
- **Change targets / office mapping**: edit `src/domain/targets.ts` / `offices.ts`, redeploy (a PR
  is the audit trail) — or, since 2026-07-08, an authorized admin can upload a new weekly targets
  workbook directly from the dashboard's "Targets" tab (see below) without a code change at all.
- **Data freshness**: the lakehouse reloads FOUR times a day since 2026-08-21 (Capricorn changed the
  schedule; confirmed 08-24). Measured off the distinct `MAX(_etl_modified)` stamps for 21–24 Aug
  2026, in **London** time: `05:43–06:22`, `11:12–11:37`, `14:34–15:10`, `17:31–17:43`. It was five
  through 20 Aug — `08:21–09:07`, `11:58–12:51`, `14:53–15:33`, `17:51–18:29`, `20:49–21:22` (n≈85
  over 1–21 Aug) — and the intraday shares in `domain/data-quality.ts` were measured against THOSE
  loads, so they are due a re-measurement from ~11 Sep. State the times as London on anything
  user-facing — they were documented as UTC without a timezone until 2026-08-21, which reads an hour
  early through BST and had the CFO expecting a load at 11:10 that actually arrives after noon. The
  times drift ±30min and loads are sometimes MISSED (20 Aug ran four of its five), so never promise a
  schedule — stamp the load. Note the last load is now ~17:35, so business entered after it does not
  land until ~06:00 the next morning; a day is only whole the following day. On a Sunday only the
  first stamp appears, which is not a missed load — the stamp moves only when rows change. Every screen stamps `Data as of <date>`, which is a different
  thing again: the last COMPLETE day, deliberately not advancing intraday. If the stamp is stale ≥2
  days, the upstream `LoadGoldCapricornShare` notebook (Smartr Fabric, PBI 90576) is where to look.
- **Env var reference**: see `.env.example` — all app settings are set by the Bicep; `PACING_MODE`
  is reserved (`mtd` today; `drip` would replay the latest day across a synthetic working day if
  Capricorn ever wants the intraday illusion).

## Weekly targets upload (item 1, 2026-07-07)

Arman (or a backup) uploads an `.xlsx` workbook from the dashboard's "Targets" tab
(`/dashboard#targets`); the app validates, persists an audit copy to Blob Storage, and activates it
immediately (no scheduled activation).

**Reversal, flagged not hidden**: `docs/UPGRADES-2026-07-07.md` §0 (same day, written first)
evaluated this and recommended reading the file from SharePoint via Graph specifically *to avoid* an
in-app upload page. Conor's later "input directly" + "csv with multiple tabs" ask chose the
previously-passed-over option — this is that build.

**Infra** (provisioned 2026-07-08 — see the CAUTION comment at the top of `main.bicep` before ever
running a full `deployment group create` against it again):

| | |
|---|---|
| Storage account | `smtcapgrowthtargetsprod` (Standard_LRS, TLS1.2, no public blob access) |
| Container | `weekly-targets` (raw upload + parsed JSON audit + `current.json` pointer) |
| Access | App's system-assigned MI granted **Storage Blob Data Contributor** on the account |

The storage account, container, and role assignment were created directly via `az storage account
create` / `az storage container create` / `az role assignment create` rather than a full bicep
redeploy — `main.bicep`'s `appSettings` array is a full REPLACE, and redeploying it without the
live `entraClientSecret`/`reportingKioskToken` values in hand would have overwritten the working
Easy Auth secret and kiosk token. `main.bicep` has been updated to describe these resources for
future IaC consistency, but wasn't itself the thing that provisioned them this time.

**Enabling uploads**: `TARGETS_ADMIN_EMAILS` is empty by default (upload fails closed — 403 for
everyone). Set it once Arman's and a backup's real addresses are confirmed:

```bash
az webapp config appsettings set -g smt-rg-capgrowth-prod -n smt-capgrowth-app-prod \
  --settings TARGETS_ADMIN_EMAILS="arman@capricornfinancial.co.uk,backup@capricornfinancial.co.uk"
```

**Template**: `GET /api/targets/template` generates a blank `.xlsx` on demand from the current
office roster (`domain/offices.ts`) — not a static checked-in file, so an office-roster change
never leaves a stale template floating around to re-sync by hand.
