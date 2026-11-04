# Moving Growth OS into Capricorn's own Azure

Growth OS runs in Smartr365's Azure today. This is the lift and shift into Capricorn's own tenant:
the same app, the same data and the same screens, at a new address. Nothing about how the board
works changes.

| | Today (Smartr365) | After the move (Capricorn) |
|---|---|---|
| Tenant | `6267379f-7bab-4fc9-b4f2-7ce573e7f9b4` | `fa37ee9e-e248-4da9-a076-87139ff736da` |
| Subscription | `Production` | `5d09ba11-2848-4b53-8b6d-71aaefb0f1db` ("Microsoft Azure", billed via Cobweb) |
| Region | North Europe | UK South |
| Resource group | `smt-rg-capgrowth-prod` | `rg-capgrowth-prod` |
| App Service | `smt-capgrowth-app-prod` (Linux B1) | `capgrowth-app-prod` (Linux B1) |
| Key Vault | `smt-kv-capgrowth-prod` | `kv-capgrowth-prod` |
| Storage | `smtcapgrowthtargetsprod` | `capgrowthtargetsprod` |
| Fabric sign-in | the app's own managed identity | multi-tenant app + federated credential (below) |
| URL | https://smt-capgrowth-app-prod.azurewebsites.net | https://capgrowth-app-prod.azurewebsites.net |

The three global names were free on 4 Nov 2026.

**Done so far (4 Nov 2026):** step 0 (providers registered), the resource group `rg-capgrowth-prod`
in UK South, step 1 apart from the client secret, and step 2.

| App registration (Capricorn tenant) | Client id |
|---|---|
| Capricorn Growth OS (Easy Auth) | `1db3612e-899b-43fb-8917-83573b5851a9` |
| Capricorn Growth OS - Fabric reader | `225c6212-e329-45bf-95b5-ef038c71f382` |

The Easy Auth secret is made at step 3, right before it is passed to the deploy, so it never has to
be kept anywhere else.

## The one hard part: reaching the data

The data does not move. It stays in the Fabric share `GAGold_Capricorn` (workspace
`GlobalAnalyticsShare`, `d578dae6-d186-4ff2-a775-83744a51bbed`) in **Smartr365's** tenant. An app in
Capricorn's tenant cannot be granted access there with its own managed identity, so it signs in like
this:

1. A **multi-tenant app registration**, "Capricorn Growth OS – Fabric reader", lives in Capricorn's
   tenant. It has **no secret**.
2. It trusts the app's **user-assigned managed identity** (`id-capgrowth-fabric-prod`) through a
   federated identity credential.
3. The app registration is also provisioned as a service principal in **Smartr365's** tenant, and
   that service principal is granted **Viewer** on `GlobalAnalyticsShare`.
4. At run time the app gets a token from its managed identity (audience
   `api://AzureADTokenExchange`), then presents it to Smartr365's tenant to get a SQL token as the
   Fabric reader (`src/services/reporting/fabric-auth.ts`).

`/healthz/lake` reports which route ran: `"auth":"federated"`.

**Fallback.** If Smartr365's tenant refuses the federated route, give the Fabric reader a client
secret and redeploy with `FABRIC_CLIENT_SECRET` set (step 3). The secret goes into Key Vault, and
`/healthz/lake` then reports `"auth":"client-secret"`. A secret expires, so put its renewal date in
someone's calendar.

Blob storage and Key Vault are in Capricorn's own tenant. The app keeps reaching them with its
system-assigned identity.

## Who does what

| Step | Who | Needs |
|---|---|---|
| 1, 2, 4 | Capricorn admin (Luke until he leaves) | Entra **Application Administrator** in Capricorn's tenant (granted) |
| 3, 6, 7 | Capricorn admin | **Contributor** on the subscription (granted) + **RBAC Administrator**, limited by a condition (requested from Cobweb, 4 Nov 2026) |
| 5 | **Smartr365**: Entra admin + Fabric admin | Rights in Smartr365's tenant and on `GlobalAnalyticsShare` |

If the RBAC Administrator grant is slow, set `GRANT_ROLES=false` at step 3 and ask Cobweb to make the
two grants that step 3 prints instead.

Every command below that targets Capricorn runs with az signed in to Capricorn's tenant, using a
separate profile so it can't touch any other az session:

```bash
export AZURE_CONFIG_DIR=~/.azure-capricorn
az login --tenant fa37ee9e-e248-4da9-a076-87139ff736da --allow-no-subscriptions
az account show --query user.name -o tsv     # luke.murphy@capricornfinancial.co.uk
SUB=5d09ba11-2848-4b53-8b6d-71aaefb0f1db
```

## 0. One-off: register the resource providers

The subscription was empty on 4 Nov 2026, with none of the providers below registered.

```bash
for ns in Microsoft.Web Microsoft.KeyVault Microsoft.Storage Microsoft.ManagedIdentity; do
  az provider register --subscription $SUB --namespace $ns --wait
done
```

## 1. Easy Auth app registration (Capricorn tenant)

Do this as in [deployment.md step 1](deployment.md#1-entra-app-registration-easy-auth), with the new
callback URL:

```bash
az ad app create --display-name "Capricorn Growth OS" --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://capgrowth-app-prod.azurewebsites.net/.auth/login/aad/callback" \
  --enable-id-token-issuance true --query appId -o tsv            # → ENTRA_CLIENT_ID
az ad app credential reset --id $ENTRA_CLIENT_ID --display-name easy-auth --years 2 \
  --query password -o tsv                                         # → ENTRA_CLIENT_SECRET
az ad sp create --id $ENTRA_CLIENT_ID
az ad app permission add --id $ENTRA_CLIENT_ID --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope
az ad app permission admin-consent --id $ENTRA_CLIENT_ID
```

**Decide who can open the dashboard.** In Smartr365's tenant, only invited Capricorn guests could
reach it. In Capricorn's own tenant, every staff account can, unless the enterprise app is set to
**Assignment required** and the right people (or a group) are assigned to it. The office TVs are
not affected: `/screens` uses the kiosk token, not a sign-in.

## 2. Fabric reader app registration (Capricorn tenant)

```bash
az ad app create --display-name "Capricorn Growth OS - Fabric reader" \
  --sign-in-audience AzureADMultipleOrgs --query appId -o tsv      # → FABRIC_CLIENT_ID
az ad sp create --id $FABRIC_CLIENT_ID
```

No secret, no API permissions. It never signs anyone in. Its only job is to be the identity the
Fabric share recognises.

## 3. Resource group + infrastructure

```bash
az group create --subscription $SUB -n rg-capgrowth-prod -l uksouth

export ENTRA_CLIENT_ID=… ENTRA_CLIENT_SECRET=… FABRIC_CLIENT_ID=…
export REPORTING_KIOSK_TOKEN=$(openssl rand -hex 24)   # new token: every TV URL changes anyway
export TARGETS_ADMIN_EMAILS=…                          # copy the live value from the Smartr app's settings
# export GRANT_ROLES=false                             # only if RBAC Administrator isn't granted yet

az deployment group create --subscription $SUB -g rg-capgrowth-prod \
  --parameters scripts/infrastructure/capricorn.bicepparam \
  --query properties.outputs
```

Note `fabricIdentityPrincipalId` and `storageAccountName` from the outputs.

If you deployed with `GRANT_ROLES=false`, someone with the rights makes these two grants for the
app's system-assigned identity (`appPrincipalId`):

```bash
az role assignment create --assignee-object-id <appPrincipalId> --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope <keyVaultId>
az role assignment create --assignee-object-id <appPrincipalId> --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Contributor" --scope <storageAccountId>
```

## 4. The federated credential (Capricorn tenant)

This lets the Fabric reader trust the app's user-assigned identity:

```bash
az ad app federated-credential create --id $FABRIC_CLIENT_ID --parameters '{
  "name": "capgrowth-app-prod",
  "issuer": "https://login.microsoftonline.com/fa37ee9e-e248-4da9-a076-87139ff736da/v2.0",
  "subject": "<fabricIdentityPrincipalId>",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

## 5. Smartr365's side (Smartr365 admins)

Step 5 is the only step that needs Smartr365. Send them the `FABRIC_CLIENT_ID`.

1. **Entra admin, Smartr365 tenant:** provision the Fabric reader as a service principal by admin
   consent. Open this URL signed in as a Smartr365 admin and accept:
   `https://login.microsoftonline.com/6267379f-7bab-4fc9-b4f2-7ce573e7f9b4/adminconsent?client_id=<FABRIC_CLIENT_ID>`
   (or `az ad sp create --id <FABRIC_CLIENT_ID>` while signed in to Smartr365's tenant).
2. **Fabric admin:** check the tenant setting *Service principals can use Fabric APIs* covers it. If
   that setting is limited to a security group, add the new service principal to the group.
3. **Workspace admin:** on `GlobalAnalyticsShare` → Manage access → add
   "Capricorn Growth OS - Fabric reader" as **Viewer**.
4. If Smartr365 runs Conditional Access for workload identities, it must not block this service
   principal.

**Who owns this after Luke leaves?** This grant, and the nightly pipeline that fills
`GAGold_Capricorn`, are in Smartr365's tenant, so a named Smartr365 owner is needed.

## 6. Ship the code

Merge to `main` first: the deploy script refuses anything else.

```bash
DEPLOY_TARGET=capricorn ./scripts/deployment/deploy-manual.sh
```

The script fails at the start if az can't see `rg-capgrowth-prod`, which means it is signed in to
the wrong tenant.

Prove the data route before going further:

```bash
curl -s https://capgrowth-app-prod.azurewebsites.net/healthz/lake
# {"status":"ok","lake":"GAGold_Capricorn","auth":"federated","ok":true}
```

- A 503 with `AADSTS700213` / `AADSTS70021` means the federated credential doesn't match. Check the
  subject is the **principal** id of `id-capgrowth-fabric-prod`, not its client id.
- A 503 with a login failure from the SQL endpoint means step 5 isn't finished, or hasn't
  propagated yet (allow ~15 min).

## 7. Copy the stored data

The storage account holds what people have entered and what the board has recorded:

- `weekly-targets`: uploaded targets workbooks and the `current.json` pointer
- `adviser-offices`: office placements made on the Adviser Offices page
- `week-snapshots`: the history behind the reconciliation screen

On 4 Nov 2026 that was 54 blobs. The app does not read blob timestamps, so a plain copy is safe.
Use account keys on both sides; this needs Contributor only, no data-plane role.

```bash
WORK=$(mktemp -d)
SRC_KEY=$(az storage account keys list --subscription Production -g smt-rg-capgrowth-prod \
  -n smtcapgrowthtargetsprod --query [0].value -o tsv)          # Smartr365 az session
DST_KEY=$(AZURE_CONFIG_DIR=~/.azure-capricorn az storage account keys list --subscription $SUB \
  -g rg-capgrowth-prod -n capgrowthtargetsprod --query [0].value -o tsv)
for c in weekly-targets adviser-offices week-snapshots; do
  mkdir -p "$WORK/$c"
  az storage blob download-batch --account-name smtcapgrowthtargetsprod --account-key "$SRC_KEY" \
    -s $c -d "$WORK/$c"
  az storage blob upload-batch --account-name capgrowthtargetsprod --account-key "$DST_KEY" \
    -d $c -s "$WORK/$c" --overwrite
done
# Counts must match per container:
for a in "smtcapgrowthtargetsprod $SRC_KEY" "capgrowthtargetsprod $DST_KEY"; do set -- $a
  for c in weekly-targets adviser-offices week-snapshots; do
    echo "$1/$c $(az storage blob list --account-name $1 --account-key $2 -c $c --query 'length(@)' -o tsv)"
  done
done
rm -rf "$WORK"
```

Then restart the app so it hydrates the targets and offices from the copied blobs:
`az webapp restart --subscription $SUB -g rg-capgrowth-prod -n capgrowth-app-prod`.

## 8. Check it matches, then run both side by side

1. `/healthz` → 200, with the `shortSha` of `main`.
2. `/healthz/lake` → `"auth":"federated"`, `"ok":true`.
3. `/dashboard` → sign in as a Capricorn user, and the screens render.
4. Sign in as a targets admin: the Targets and Adviser Offices pages allow changes. They read
   `TARGETS_ADMIN_EMAILS` against the signed-in email, which should be the same address as before;
   check it.
5. Compare the two apps' kiosk data for the same dataset. The figures must agree:
   `/api/kiosk?dataset=…&k=<token>` on each host, using each host's own token.
6. `/screens?k=<new token>` on one TV, left running for a day.

## 9. Cut over

1. Agree a short window with Capricorn. **No targets uploads and no office changes on the old app
   from now on**, or they would be lost.
2. Re-run step 7 to pick up anything entered since the first copy.
3. Point every TV at `https://capgrowth-app-prod.azurewebsites.net/screens?k=<new token>`.
4. Tell dashboard users the new address.
5. Leave the Smartr365 app running, unchanged, for a week as the way back.

## 10. Retire the Smartr365 copy

After a clean week:

1. Delete `smt-rg-capgrowth-prod`. This removes the app, its identity (and with it the old Fabric
   grant), the Key Vault and the old storage.
2. Delete the Smartr365-tenant Easy Auth app registration "Capricorn Growth OS".
3. Make `capricorn` the default `DEPLOY_TARGET` in `scripts/deployment/deploy-manual.sh`, and point
   the defaults in `docs/deployment.md` at the new home.
