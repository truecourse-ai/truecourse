// Isolated staging experiment: native TrueCourse + Docker + local Postgres.
// Reuses dev's existing identity, ACR and Key Vault; creates no shared DB writes.
param location string = resourceGroup().location
param name string = 'truecourse-vmtest'
param vmSize string = 'Standard_D4s_v7'
param adminUsername string = 'azureuser'
param sshPublicKey string
@description('Only this public CIDR may SSH. HTTP/HTTPS are public.')
param sshSourceCidr string
param identityId string
param identityClientId string
param keyVaultName string
@description('Existing dev application image, preferably pinned by digest.')
param image string
param dnsLabel string = '${name}-${uniqueString(resourceGroup().id, name)}'
param tags object = { purpose: 'guard-vm-experiment', environment: 'staging' }

var fqdn = '${dnsLabel}.${location}.cloudapp.azure.com'
var config = {
  tenantId: subscription().tenantId
  identityClientId: identityClientId
  keyVaultName: keyVaultName
  image: image
  fqdn: fqdn
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
    content: __MANAGE__
runcmd:
  - [bash, /usr/local/sbin/truecourse-bootstrap]
'''
var cloudConfig = replace(replace(replace(cloudConfigTemplate,
  '__CONFIG__', base64(string(config))),
  '__BOOTSTRAP__', base64(loadTextContent('vm/bootstrap.sh'))),
  '__MANAGE__', base64(loadTextContent('vm/manage.py')))

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
          sourceAddressPrefix: sshSourceCidr
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
    addressSpace: { addressPrefixes: ['10.84.0.0/16'] }
    subnets: [{ name: 'vm', properties: { addressPrefix: '10.84.1.0/24' } }]
  }
}
resource publicIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: '${name}-ip'
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
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
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: name
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identityId}': {} } }
  properties: {
    hardwareProfile: { vmSize: vmSize }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        name: '${name}-os'
        createOption: 'FromImage'
        diskSizeGB: 256
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
        // Keep the experiment's database if the VM resource is deleted.
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

output vmName string = vm.name
output publicIpAddress string = publicIp.properties.ipAddress
output url string = 'https://${fqdn}'
output workosRedirectUri string = 'https://${fqdn}/api/auth/callback'
output sshCommand string = 'ssh ${adminUsername}@${fqdn}'
