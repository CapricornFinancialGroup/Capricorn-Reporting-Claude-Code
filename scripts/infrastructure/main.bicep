// Infrastructure for Capricorn Growth OS.
//
// Standalone deployment in its own resource group: a dedicated Linux App Service Plan, a Node web
// app, Easy Auth (Entra) via authsettingsV2, and a Key Vault holding the kiosk token. The app reads
// the Capricorn Fabric lakehouse share (GAGold_Capricorn) with its system-assigned managed
// identity — that identity must ALSO be granted Viewer on the Fabric workspace GlobalAnalyticsShare
// (a Fabric-side step, not ARM; see docs/deployment.md step 3).
//
// The Entra app registration is NOT created here (it's an AAD object, not ARM) — pass its
// clientId/secret as params.
//
//   az deployment group create -g smt-rg-capgrowth-prod \
//     --template-file scripts/infrastructure/main.bicep \
//     --parameters env=prod entraClientId=<appId> entraClientSecret=<secret> \
//                  reportingKioskToken=<kiosk-secret> targetsAdminEmails=<comma-separated>
//
// CAUTION: appSettings below is a full REPLACE, not a merge — redeploying without the real
// entraClientSecret/reportingKioskToken values would overwrite the live Easy Auth secret and kiosk
// token with garbage. The targetsStorage* resources (2026-07-08, item 1) were provisioned
// out-of-band via plain `az storage account create` / `az role assignment create` / `az webapp
// config appsettings set` (which merges) specifically to avoid that risk — this file matches what's
// live, but hasn't itself been the thing that created it. Rehydrate the two secrets before ever
// running a full `deployment group create` against this template again.

targetScope = 'resourceGroup'

param location string = resourceGroup().location
param env string = 'prod'
param projectName string = 'capgrowth'
param appServiceName string = 'smt-${projectName}-app-${env}'
param planName string = 'smt-${projectName}-plan-${env}'
param planSku string = 'B1'
param tenantId string = subscription().tenantId
param keyVaultName string = 'smt-kv-${projectName}-${env}'

// Weekly targets upload (item 1, 2026-07-07) — audit blob storage. Name must be globally unique,
// lowercase letters+digits only, <=24 chars.
param targetsStorageAccountName string = 'smt${projectName}targets${env}'
// Emails allowed to upload targets (comma-separated, lower-cased in config.ts). Empty = upload
// disabled (fails closed) — collect Arman's + a backup's address before setting this for real.
param targetsAdminEmails string = ''

// The Capricorn Fabric lakehouse share (read-only, rebuilt nightly).
param fabricSqlEndpoint string = 't43woyvlppeu7nhsptsxhz7zwq-43nhrvmg2hze7j3vqn2euun35u.datawarehouse.fabric.microsoft.com'
param fabricDatabase string = 'GAGold_Capricorn'

// Easy Auth (Entra). The app registration is created out-of-band; pass its details here.
param entraClientId string
@secure()
param entraClientSecret string

// The kiosk surface (/screens, /api/kiosk) is Easy-Auth-excluded and gated by this token instead,
// so office TVs need no login. Stored in Key Vault, KV-ref'd below.
@secure()
param reportingKioskToken string

resource plan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: { name: planSku }
  properties: { reserved: true } // Linux
}

resource app 'Microsoft.Web/sites@2022-09-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    httpsOnly: true
    serverFarmId: plan.id
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      alwaysOn: true
      http20Enabled: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appCommandLine: 'node dist/index.js'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'LOG_LEVEL', value: 'info' }
        { name: 'FABRIC_SQL_ENDPOINT', value: fabricSqlEndpoint }
        { name: 'FABRIC_DATABASE', value: fabricDatabase }
        { name: 'REPORTING_KIOSK_TOKEN', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=capgrowth-kiosk-token)' }
        { name: 'REPORTING_REFRESH_SECONDS', value: '60' }
        { name: 'REPORTING_CYCLE_SECONDS', value: '20' }
        { name: 'REPORTING_TIMEZONE', value: 'Europe/London' }
        { name: 'PACING_MODE', value: 'mtd' }
        { name: 'REPORTING_CACHE_TTL_SECONDS', value: '45' }
        // Easy Auth client secret (referenced by authsettingsV2 below).
        { name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: entraClientSecret }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'TARGETS_ADMIN_EMAILS', value: targetsAdminEmails }
        { name: 'TARGETS_STORAGE_ACCOUNT', value: targetsStorageAccountName }
      ]
    }
  }
}

// Easy Auth (App Service Authentication v2) — Entra, require auth, redirect browsers to login.
// The kiosk is excluded so office TVs need no login: /screens (self-contained single-file shell,
// no external assets) and /api/kiosk (token-gated data; the dataset is a query param so this ONE
// exact path covers all datasets). NOTE: excludedPaths is EXACT-match only — no prefix/wildcard —
// which is why the SPA is inlined into one file and the kiosk data path takes ?dataset=.
// /healthz + /healthz/lake stay anonymous for probes. The dashboard (/dashboard, /api/reporting/*)
// stays behind Easy Auth; Capricorn users sign in as B2B guests in this tenant.
resource auth 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: app
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: [ '/healthz', '/healthz/lake', '/screens', '/api/kiosk' ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: 'https://sts.windows.net/${tenantId}/'
          clientId: entraClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: { allowedAudiences: [ entraClientId, 'api://${entraClientId}' ] }
      }
    }
    login: { tokenStore: { enabled: true } }
  }
}

// Key Vault holding the kiosk token; the app reads it via its managed identity (KV reference).
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
  }
}

// Kiosk shared secret — rotate by updating this secret and restarting the app.
resource kioskTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'capgrowth-kiosk-token'
  properties: { value: reportingKioskToken }
}

// Grant the app's managed identity read access to the vault's secrets (Key Vault Secrets User).
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, app.id, 'kv-secrets-user')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Weekly targets upload (item 1, 2026-07-07) — audit blob storage. Table Storage is this org's
// convention for background-pipeline STATE, not file-upload AUDIT — wrong shape for "~29 numbers a
// week from a human-authored document", hence a dedicated storage account + blob container instead.
resource targetsStorage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: targetsStorageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource targetsBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: targetsStorage
  name: 'default'
}

resource targetsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: targetsBlobService
  name: 'weekly-targets'
  properties: { publicAccess: 'None' }
}

// Grant the app's managed identity read/write on the container (same DefaultAzureCredential
// pattern already used for the Fabric SQL pool — no new auth idiom).
resource targetsBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(targetsStorage.id, app.id, 'storage-blob-data-contributor')
  scope: targetsStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output appUrl string = 'https://${app.properties.defaultHostName}'
output appPrincipalId string = app.identity.principalId
