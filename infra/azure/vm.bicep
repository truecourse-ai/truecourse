// Replaces application compute only. Existing environment services remain owned
// by foundation.bicep. Provisioning prepares the host; the first release starts the app.
param location string = 'westus3'
@allowed(['dev', 'prod'])
param environment string
param vmSize string = 'Standard_D4s_v7'
param diskSizeGB int = 256
param adminUsername string = 'azureuser'
param sshPublicKey string
@description('Operator public IPv4 address without a CIDR suffix. SSH is restricted to this /32.')
param sshSourceIp string
param identityName string = 'truecourse-id'
param logAnalyticsWorkspaceName string = 'truecourse-logs'
@description('Enable alerts only after cutover. Log collection is always installed.')
param monitoringEnabled bool = false
// Environment resource names live here, alongside the infrastructure that uses them.
var environments = {
  dev: {
    name: 'truecourse-dev'
    fqdn: ''
    dnsLabel: 'truecourse-dev'
    keyVaultName: 'truecoursekvk7ncoyeug2nb'
    registryName: 'truecourseacrk7ncoyeug2nb2'
    databaseServerName: 'truecourse-pg-k7ncoyeug2nb2'
    vnetAddressPrefix: '10.85.0.0/16'
    subnetAddressPrefix: '10.85.1.0/24'
  }
  prod: {
    name: 'truecourse-production'
    fqdn: 'app.truecourse.dev'
    dnsLabel: ''
    keyVaultName: 'truecoursekvqotlfmmtzmyp'
    registryName: 'truecourseacrqotlfmmtzmyp4'
    databaseServerName: 'truecourse-pg-qotlfmmtzmyp4'
    vnetAddressPrefix: '10.86.0.0/16'
    subnetAddressPrefix: '10.86.1.0/24'
  }
}
var settings = environments[environment]
var name = settings.name
var fqdn = empty(settings.fqdn) ? '${settings.dnsLabel}.${location}.cloudapp.azure.com' : settings.fqdn
var keyVaultName = settings.keyVaultName
var registryName = settings.registryName
var databaseServerName = settings.databaseServerName
var vnetAddressPrefix = settings.vnetAddressPrefix
var subnetAddressPrefix = settings.subnetAddressPrefix

var tags = { application: 'truecourse', environment: environment, deployment: 'vm' }

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: identityName
}
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: databaseServerName
}
var config = {
  environment: environment
  resourceGroup: resourceGroup().name
  subscriptionId: subscription().subscriptionId
  tenantId: subscription().tenantId
  identityClientId: identity.properties.clientId
  keyVaultName: keyVault.name
  registryName: registry.name
  registryLoginServer: registry.properties.loginServer
  databaseServerName: database.name
  fqdn: fqdn
  vmName: name
}
var cloudConfigTemplate = '''
#cloud-config
write_files:
  - path: /etc/truecourse-vm.json
    permissions: '0644'
    encoding: b64
    content: __CONFIG__
  - path: /usr/local/sbin/truecourse-bootstrap
    permissions: '0750'
    encoding: b64
    content: __BOOTSTRAP__
  - path: /usr/local/sbin/truecourse-vm
    permissions: '0750'
    encoding: b64
    content: __RELEASE__
runcmd:
  - [bash, /usr/local/sbin/truecourse-bootstrap]
'''
var cloudConfig = replace(replace(replace(cloudConfigTemplate,
  '__CONFIG__', base64(string(config))),
  '__BOOTSTRAP__', base64(loadTextContent('../../.github/scripts/vm-bootstrap.sh'))),
  '__RELEASE__', base64(loadTextContent('../../.github/scripts/vm-release.py')))

resource nsg 'Microsoft.Network/networkSecurityGroups@2024-05-01' = {
  name: '${name}-nsg'
  location: location
  tags: tags
  properties: {
    securityRules: [
      {
        name: 'ssh-operator'
        properties: {
          priority: 100
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '${sshSourceIp}/32'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'https-and-acme'
        properties: {
          priority: 110
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: 'Internet'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRanges: ['80', '443']
        }
      }
    ]
  }
}
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${name}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [vnetAddressPrefix] }
    subnets: [{ name: 'vm', properties: { addressPrefix: subnetAddressPrefix } }]
  }
}
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${name}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: union({ publicIPAllocationMethod: 'Static', publicIPAddressVersion: 'IPv4' },
    empty(settings.dnsLabel) ? {} : { dnsSettings: { domainNameLabel: settings.dnsLabel } })
}
resource nic 'Microsoft.Network/networkInterfaces@2024-05-01' = {
  name: '${name}-nic'
  location: location
  tags: tags
  properties: {
    networkSecurityGroup: { id: nsg.id }
    ipConfigurations: [{
      name: 'primary'
      properties: {
        privateIPAllocationMethod: 'Dynamic'
        subnet: { id: '${vnet.id}/subnets/vm' }
        publicIPAddress: { id: publicIp.id }
      }
    }]
  }
}
// Add an explicit VM address without changing the server, backup policy or
// storage auto-growth. Operator addresses are hand-added rules beside this one.
resource databaseFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: database
  name: '${name}-egress'
  properties: {
    startIpAddress: publicIp.properties.ipAddress
    endIpAddress: publicIp.properties.ipAddress
  }
}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: { publisher: 'Canonical', offer: 'ubuntu-24_04-lts', sku: 'server', version: 'latest' }
      osDisk: {
        name: '${name}-os'
        createOption: 'FromImage'
        diskSizeGB: diskSizeGB
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
        deleteOption: 'Detach'
      }
    }
    osProfile: {
      computerName: name
      adminUsername: adminUsername
      customData: base64(cloudConfig)
      linuxConfiguration: {
        disablePasswordAuthentication: true
        provisionVMAgent: true
        ssh: { publicKeys: [{ path: '/home/${adminUsername}/.ssh/authorized_keys', keyData: sshPublicKey }] }
      }
    }
    securityProfile: {
      securityType: 'TrustedLaunch'
      uefiSettings: { secureBootEnabled: true, vTpmEnabled: true }
    }
    networkProfile: { networkInterfaces: [{ id: nic.id }] }
    diagnosticsProfile: { bootDiagnostics: { enabled: true } }
  }
}
module monitoring './vm-monitoring.bicep' = {
  name: '${name}-monitoring'
  params: {
    location: location
    vmName: vm.name
    identityId: identity.id
    workspaceName: logAnalyticsWorkspaceName
    databaseServerName: database.name
    enabled: monitoringEnabled
    tags: tags
  }
}
output vmName string = vm.name
output publicIpAddress string = publicIp.properties.ipAddress
output url string = 'https://${fqdn}'
output dnsRecord object = { type: 'A', name: fqdn, value: publicIp.properties.ipAddress }
output sshCommand string = 'ssh ${adminUsername}@${publicIp.properties.ipAddress}'
output workosRedirectUri string = 'https://${fqdn}/api/auth/callback'

// GitHub Actions reads these outputs; no duplicate environment configuration.
output releaseConfig object = {
  environment: environment
  resourceGroup: resourceGroup().name
  vmName: vm.name
  registryName: registry.name
  registryLoginServer: registry.properties.loginServer
  url: 'https://${fqdn}'
}
output monitoringParameters object = {
  location: { value: location }
  vmName: { value: vm.name }
  identityId: { value: identity.id }
  workspaceName: { value: logAnalyticsWorkspaceName }
  databaseServerName: { value: database.name }
  enabled: { value: true }
  tags: { value: tags }
}
