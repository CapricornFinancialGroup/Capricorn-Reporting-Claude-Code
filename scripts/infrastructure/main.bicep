// Infrastructure for Capricorn Growth OS.
//
// ONE template, two homes. The defaults describe the original deployment in Smartr365's Azure
// (smt-* names, same-tenant Fabric access). capricorn.bicepparam deploys the same thing into
// Capricorn's own tenant: no smt- prefix, UK South, and cross-tenant Fabric access through a
// user-assigned identity (fabricClientId set). See docs/capricorn-tenant-move.md.
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
// 'smt-' in Smartr's Azure, '' in Capricorn's. Every name below derives from it.
param namePrefix string = 'smt-'
param appServiceName string = '${namePrefix}${projectName}-app-${env}'
param planName string = '${namePrefix}${projectName}-plan-${env}'
param planSku string = 'B1'
param tenantId string = subscription().tenantId
param keyVaultName string = '${namePrefix}kv-${projectName}-${env}'

// Weekly targets upload (item 1, 2026-07-07) — audit blob storage. Name must be globally unique,
// lowercase letters+digits only, <=24 chars. Also holds the adviser-offices and week-snapshots
// containers.
param targetsStorageAccountName string = '${replace(namePrefix, '-', '')}${projectName}targets${env}'

// Creating role assignments needs Owner / RBAC Administrator, which Contributor lacks. false lets a
// Contributor stand the resources up first; the grants are then made separately (the app cannot
// read its Key Vault secret or blobs until they are).
param grantRoles bool = true
// Emails allowed to upload targets (comma-separated, lower-cased in config.ts). Empty = upload
// disabled (fails closed) — collect Arman's + a backup's address before setting this for real.
param targetsAdminEmails string = ''

// The Capricorn Fabric lakehouse share (read-only, rebuilt nightly).
param fabricSqlEndpoint string = 't43woyvlppeu7nhsptsxhz7zwq-43nhrvmg2hze7j3vqn2euun35u.datawarehouse.fabric.microsoft.com'
param fabricDatabase string = 'GAGold_Capricorn'

// Cross-tenant Fabric access (only when the app runs outside Smartr365's tenant). Leave
// fabricClientId empty for the original same-tenant managed identity. When set, a user-assigned
// identity is created for the app; the multi-tenant app registration fabricClientId must trust it
// through a federated credential (Entra, not ARM: see docs/capricorn-tenant-move.md), and that app's
// service principal in fabricTenantId must hold Viewer on the share's workspace.
param fabricTenantId string = ''
param fabricClientId string = ''
param fabricIdentityName string = '${namePrefix}id-${projectName}-fabric-${env}'
var crossTenantFabric = !empty(fabricClientId)
// FALLBACK ONLY: if Smartr's tenant refuses the federated credential, give the app registration a
// client secret and pass it here. It goes to Key Vault and the app signs in with it instead.
@secure()
param fabricClientSecret string = ''
var fabricUsesSecret = crossTenantFabric && !empty(fabricClientSecret)

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

// The identity the Fabric app registration trusts. User-assigned so its principal id (which the
// federated credential names) survives the web app being deleted and recreated.
resource fabricIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (crossTenantFabric) {
  name: fabricIdentityName
  location: location
}

// Storage and Key Vault stay on the system-assigned identity (DefaultAzureCredential uses it while
// AZURE_CLIENT_ID is unset); the user-assigned one is only for the Fabric federated credential.
var crossTenantSettings = crossTenantFabric ? [
  { name: 'FABRIC_TENANT_ID', value: fabricTenantId }
  { name: 'FABRIC_CLIENT_ID', value: fabricClientId }
  { name: 'FABRIC_MI_CLIENT_ID', value: fabricIdentity!.properties.clientId }
] : []
var fabricSecretSettings = fabricUsesSecret ? [
  { name: 'FABRIC_CLIENT_SECRET', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=capgrowth-fabric-client-secret)' }
] : []

resource app 'Microsoft.Web/sites@2022-09-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  identity: crossTenantFabric ? {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: { '${fabricIdentity.id}': {} }
  } : { type: 'SystemAssigned' }
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
      appSettings: concat([
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
        // PBI 93610: key the dataset cache on the Gold data version. 'false' is the rollback to pure
        // wall-clock TTLs (change it here too: the next infra deploy resets a portal edit). The probe
        // interval and the max age are in seconds; the max age bounds anything the version cannot see.
        { name: 'REPORTING_KEY_ON_DATA_VERSION', value: 'true' }
        { name: 'REPORTING_VERSION_PROBE_SECONDS', value: '600' }
        { name: 'REPORTING_VERSIONED_CACHE_MAX_SECONDS', value: '21600' }
        // Easy Auth client secret (referenced by authsettingsV2 below).
        { name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: entraClientSecret }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'TARGETS_ADMIN_EMAILS', value: targetsAdminEmails }
        { name: 'TARGETS_STORAGE_ACCOUNT', value: targetsStorageAccountName }
      ], crossTenantSettings, fabricSecretSettings)
    }
  }
}

// Easy Auth (App Service Authentication v2) — Entra, require auth, redirect browsers to login.
// The kiosk is excluded so office TVs need no login: /screens (self-contained single-file shell,
// no external assets) and /api/kiosk (token-gated data; the dataset is a query param so this ONE
// exact path covers all datasets). NOTE: excludedPaths is EXACT-match only — no prefix/wildcard —
// which is why the SPA is inlined into one file and the kiosk data path takes ?dataset=.
// /healthz + /healthz/lake stay anonymous for probes. The dashboard (/dashboard, /api/reporting/*)
// stays behind Easy Auth. In Smartr365's tenant Capricorn users sign in as B2B guests; in Capricorn's
// own tenant they sign in as themselves.
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

resource fabricSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (fabricUsesSecret) {
  parent: kv
  name: 'capgrowth-fabric-client-secret'
  properties: { value: fabricClientSecret }
}

// Grant the app's managed identity read access to the vault's secrets (Key Vault Secrets User).
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (grantRoles) {
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

// The app also creates these on first write (createIfNotExists); declaring them means a fresh
// account can be loaded with copied blobs before the app has ever run.
resource officesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: targetsBlobService
  name: 'adviser-offices'
  properties: { publicAccess: 'None' }
}

resource snapshotsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: targetsBlobService
  name: 'week-snapshots'
  properties: { publicAccess: 'None' }
}

// Grant the app's managed identity read/write on the container (same DefaultAzureCredential
// pattern already used for the Fabric SQL pool — no new auth idiom).
resource targetsBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (grantRoles) {
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
// Grants to make by hand when grantRoles=false (scope ids for az role assignment create).
output keyVaultId string = kv.id
output storageAccountId string = targetsStorage.id
// The federated credential's subject (empty when same-tenant).
output fabricIdentityPrincipalId string = crossTenantFabric ? fabricIdentity!.properties.principalId : ''
output storageAccountName string = targetsStorageAccountName
