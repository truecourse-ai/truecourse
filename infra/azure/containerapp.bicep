// One TrueCourse Container App (deploy once per environment: dev, prod).
// Pulls the image from ACR and reads its bootstrap secrets from Key Vault, both
// via the user-assigned managed identity created by foundation.bicep.
//
//   az deployment group create -g rg-truecourse-dev -f infra/azure/containerapp.bicep \
//     -p name=truecourse-dev image=<acr>.azurecr.io/truecourse:bootstrap \
//        environmentId=<env> identityId=<id> acrLoginServer=<acr>.azurecr.io \
//        keyVaultUri=https://<kv>.vault.azure.net/
//
// IMPORTANT: every name in `secretEnv` must already exist in Key Vault (dashed,
// lower-case — e.g. DATABASE_URL -> database-url). Run set-secrets.sh first.

@description('Container App name, e.g. truecourse-dev / truecourse-prod.')
param name string

param location string = resourceGroup().location

@description('Managed environment resource id (foundation output environmentId).')
param environmentId string

@description('User-assigned identity resource id (foundation output identityId).')
param identityId string

@description('ACR login server, e.g. myreg.azurecr.io (foundation output acrLoginServer).')
param acrLoginServer string

@description('Key Vault URI WITH trailing slash (foundation output keyVaultUri).')
param keyVaultUri string

@description('Full image reference, e.g. myreg.azurecr.io/truecourse:pr-12-abc1234.')
param image string

@description('Edition: enterprise (Postgres + SSO) or community (file-based).')
param edition string = 'enterprise'

param minReplicas int = 1
param maxReplicas int = 1
param targetPort int = 3001
param tags object = {}

@description('Env vars sourced from Key Vault secrets. Each MUST exist in KV (dashed name).')
param secretEnv array = [
  'DATABASE_URL'
  'TRUECOURSE_SECRET_KEY'
  'WORKOS_API_KEY'
  'WORKOS_CLIENT_ID'
  'WORKOS_COOKIE_PASSWORD'
  'WORKOS_REDIRECT_URI'
  'WORKOS_APP_URL'
  'GITHUB_APP_ID'
  'GITHUB_APP_PRIVATE_KEY'
  'GITHUB_APP_WEBHOOK_SECRET'
  'GITHUB_APP_SLUG'
  'SENTRY_DSN'
]

var secrets = map(secretEnv, name => {
  name: toLower(replace(name, '_', '-'))
  keyVaultUrl: '${keyVaultUri}secrets/${toLower(replace(name, '_', '-'))}'
  identity: identityId
})

var secretEnvVars = map(secretEnv, name => {
  name: name
  secretRef: toLower(replace(name, '_', '-'))
})

// Tag Sentry by env so dev and prod errors are separated — both containers run
// NODE_ENV=production, so without this they'd both report as "production".
var sentryEnvironment = contains(toLower(name), 'prod') ? 'production' : 'development'

var plainEnvVars = [
  { name: 'PORT', value: string(targetPort) }
  { name: 'TRUECOURSE_EDITION', value: edition }
  { name: 'TRUECOURSE_LOG_DIR', value: '/data/logs' }
  { name: 'SENTRY_ENVIRONMENT', value: sentryEnvironment }
]

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto' // supports the Socket.io websocket upgrade
        allowInsecure: false
        traffic: [
          { latestRevision: true, weight: 100 }
        ]
      }
      registries: [
        { server: acrLoginServer, identity: identityId }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'truecourse'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(plainEnvVars, secretEnvVars)
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/', port: targetPort }
              initialDelaySeconds: 45
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/', port: targetPort }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
          ]
        }
      ]
      // minReplicas >= 1 so the in-process graphile-worker keeps processing jobs
      // (no scale-to-zero). >1 replica needs Socket.io sticky sessions / a Redis
      // adapter — keep dev at 1.
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
