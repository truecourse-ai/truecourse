// Single-environment Azure foundation for TrueCourse hosting (resource-group
// scoped): the managed services the VM host reuses — Log Analytics, container
// registry, Key Vault, a user-assigned managed identity (ACR pull + KV read),
// and a Postgres Flexible Server. Deploy ONCE PER ENVIRONMENT — each into its own
// resource group (rg-truecourse-dev, rg-truecourse-prod) — so dev and prod never
// share a database or secrets. Then set the Key Vault secrets
// (infra/azure/set-secrets.sh) and provision the VM host (vm.bicep, see
// vm/DEPLOYMENT.md). Both environments are deployed; this file is the record.
//
//   az group create -n rg-truecourse-dev -l westus3
//   az deployment group create -g rg-truecourse-dev -f infra/azure/foundation.bicep \
//     -p postgresAdminPassword='<strong-pw>'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short prefix for resource names (lowercase, 3-12 chars).')
@minLength(3)
@maxLength(12)
param namePrefix string = 'truecourse'

@description('PostgreSQL admin username.')
param postgresAdminLogin string = 'tcadmin'

@description('PostgreSQL admin password (set at deploy; never commit).')
@secure()
param postgresAdminPassword string

@description('PostgreSQL Flexible Server SKU (Burstable tier).')
param postgresSku string = 'Standard_B1ms'

param tags object = {}

var acrName = toLower('${namePrefix}acr${uniqueString(resourceGroup().id)}')
var kvName = take(toLower('${namePrefix}kv${uniqueString(resourceGroup().id)}'), 24)
var pgName = toLower('${namePrefix}-pg-${uniqueString(resourceGroup().id)}')

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false // pulls use the managed identity, not admin creds
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id'
  location: location
  tags: tags
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true // grant via role assignment below
    enableSoftDelete: true
  }
}

resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: pgName
  location: location
  tags: tags
  sku: {
    name: postgresSku
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: pg
  name: 'truecourse'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// No firewall rule here: vm.bicep adds the VM's own egress address, and any
// operator address is added by hand. The server is otherwise closed.

// Built-in role IDs.
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var kvSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRole)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, identity.id, kvSecretsUserRole)
  scope: kv
  properties: {
    roleDefinitionId: kvSecretsUserRole
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name
output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output keyVaultName string = kv.name
output keyVaultUri string = kv.properties.vaultUri
output postgresFqdn string = pg.properties.fullyQualifiedDomainName
output postgresDatabase string = pgDb.name
