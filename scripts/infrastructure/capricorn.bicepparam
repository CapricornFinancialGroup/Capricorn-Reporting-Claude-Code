// Growth OS in Capricorn's own Azure tenant (fa37ee9e-e248-4da9-a076-87139ff736da),
// subscription 5d09ba11-2848-4b53-8b6d-71aaefb0f1db, resource group rg-capgrowth-prod, UK South.
//
// Secrets and ids come from the environment so nothing sensitive is committed:
//   ENTRA_CLIENT_ID / ENTRA_CLIENT_SECRET  Easy Auth app registration (Capricorn tenant)
//   FABRIC_CLIENT_ID                       multi-tenant app the share trusts (Capricorn tenant)
//   REPORTING_KIOSK_TOKEN                  the kiosk token (reuse the live one so TVs keep their token)
//   TARGETS_ADMIN_EMAILS                   comma-separated, as live
//
//   az deployment group create --subscription 5d09ba11-2848-4b53-8b6d-71aaefb0f1db \
//     -g rg-capgrowth-prod --parameters scripts/infrastructure/capricorn.bicepparam
//
// See docs/capricorn-tenant-move.md for the full order of work.

using './main.bicep'

param location = 'uksouth'
param namePrefix = ''

// The share lives in Smartr365's tenant (decoded from the Fabric endpoint's hostname).
param fabricTenantId = '6267379f-7bab-4fc9-b4f2-7ce573e7f9b4'
param fabricClientId = readEnvironmentVariable('FABRIC_CLIENT_ID')
// Fallback only, if the federated credential is refused: leave FABRIC_CLIENT_SECRET unset normally.
param fabricClientSecret = readEnvironmentVariable('FABRIC_CLIENT_SECRET', '')

param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET')
param reportingKioskToken = readEnvironmentVariable('REPORTING_KIOSK_TOKEN')
param targetsAdminEmails = readEnvironmentVariable('TARGETS_ADMIN_EMAILS', '')

// Set false to stand the resources up with Contributor alone, then grant the two roles separately.
param grantRoles = bool(readEnvironmentVariable('GRANT_ROLES', 'true'))
