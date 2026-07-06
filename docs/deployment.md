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
```

Capricorn users authenticate as B2B guests in this tenant — no extra registration config needed.
Optionally set "Assignment required" on the enterprise app and assign a `Capricorn Growth OS Users`
group to restrict who can open the dashboard.

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
  is the audit trail).
- **Data freshness**: the lakehouse rebuilds ~03:15 UTC daily (after the ~23:00 UTC Gold load);
  every screen stamps `Data as of <date>`. If the stamp is stale ≥2 days, the upstream
  `LoadGoldCapricornShare` notebook (Smartr Fabric, PBI 90576) is the place to look.
- **Env var reference**: see `.env.example` — all app settings are set by the Bicep; `PACING_MODE`
  is reserved (`mtd` today; `drip` would replay the latest day across a synthetic working day if
  Capricorn ever wants the intraday illusion).
