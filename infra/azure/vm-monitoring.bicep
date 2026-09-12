// Existing workspace, new VM collection and disabled-until-cutover alerts.
param location string
param vmName string
param identityId string
param workspaceName string
param databaseServerName string
param enabled bool = false
param tags object = {}
resource vm 'Microsoft.Compute/virtualMachines@2024-07-01' existing = { name: vmName }
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: workspaceName }
resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = { name: databaseServerName }
var logColumns = [
  { name: 'TimeGenerated', type: 'datetime' }
  { name: 'RawData', type: 'string' }
  { name: 'FilePath', type: 'string' }
  { name: 'Computer', type: 'string' }
]
var logTables = [
  { name: 'TrueCourseApp_CL', path: '/var/log/truecourse/dashboard.log' }
  { name: 'TrueCourseHealth_CL', path: '/var/log/truecourse/health.log' }
]
var customFlows = [for log in logTables: {
  streams: ['Custom-${log.name}']
  destinations: ['existing-workspace']
  transformKql: 'source'
  outputStream: 'Custom-${log.name}'
}]
resource tables 'Microsoft.OperationalInsights/workspaces/tables@2022-10-01' = [for log in logTables: {
  parent: workspace
  name: log.name
  properties: {
    plan: 'Analytics'
    retentionInDays: 30
    totalRetentionInDays: 30
    schema: { name: log.name, columns: logColumns }
  }
}]
resource endpoint 'Microsoft.Insights/dataCollectionEndpoints@2023-03-11' = {
  name: '${vmName}-logs'
  location: location
  tags: tags
  kind: 'Linux'
  properties: { networkAcls: { publicNetworkAccess: 'Enabled' } }
}
resource agent 'Microsoft.Compute/virtualMachines/extensions@2024-07-01' = {
  parent: vm
  name: 'AzureMonitorLinuxAgent'
  location: location
  tags: tags
  properties: {
    publisher: 'Microsoft.Azure.Monitor'
    type: 'AzureMonitorLinuxAgent'
    typeHandlerVersion: '1.0'
    autoUpgradeMinorVersion: true
    enableAutomaticUpgrade: true
    settings: {
      authentication: {
        managedIdentity: { 'identifier-name': 'mi_res_id', 'identifier-value': identityId }
      }
    }
  }
  // Publish collection associations before the agent's first configuration fetch.
  dependsOn: [association, endpointAssociation]
}
resource collection 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: '${vmName}-logs'
  location: location
  tags: tags
  kind: 'Linux'
  properties: {
    dataCollectionEndpointId: endpoint.id
    streamDeclarations: {
      'Custom-TrueCourseApp_CL': { columns: logColumns }
      'Custom-TrueCourseHealth_CL': { columns: logColumns }
    }
    dataSources: {
      // Health is JSON-lines; app logs begin with a bracketed ISO timestamp.
      // Neither starts with the configured timestamp, so AMA uses end-of-line
      // record boundaries. Keep each health sample on one appended UTF-8 line.
      // https://learn.microsoft.com/azure/azure-monitor/vm/data-collection-log-text
      logFiles: [for log in logTables: {
        name: log.name
        streams: ['Custom-${log.name}']
        filePatterns: [log.path]
        format: 'text'
        settings: { text: { recordStartTimestampFormat: 'ISO 8601' } }
      }]
      performanceCounters: [{
        name: 'host-resources'
        streams: ['Microsoft-Perf']
        samplingFrequencyInSeconds: 60
        counterSpecifiers: [
          'Processor(*)\\% Processor Time'
          'Memory(*)\\% Used Memory'
          'Logical Disk(*)\\% Free Space'
          'Logical Disk(*)\\Free Megabytes'
        ]
      }]
      syslog: [{
        name: 'host-events'
        streams: ['Microsoft-Syslog']
        facilityNames: ['auth', 'authpriv', 'daemon', 'kern', 'syslog']
        logLevels: ['Warning', 'Error', 'Critical', 'Alert', 'Emergency']
      }]
    }
    destinations: { logAnalytics: [{ name: 'existing-workspace', workspaceResourceId: workspace.id }] }
    dataFlows: concat(customFlows, [
      { streams: ['Microsoft-Perf'], destinations: ['existing-workspace'] }
      { streams: ['Microsoft-Syslog'], destinations: ['existing-workspace'] }
    ])
  }
  dependsOn: [tables]
}
resource endpointAssociation 'Microsoft.Insights/dataCollectionRuleAssociations@2023-03-11' = {
  name: 'configurationAccessEndpoint'
  scope: vm
  properties: { dataCollectionEndpointId: endpoint.id }
}
resource association 'Microsoft.Insights/dataCollectionRuleAssociations@2023-03-11' = {
  name: 'truecourse-logs'
  scope: vm
  properties: { dataCollectionRuleId: collection.id }
}
// Recipients are managed in Azure only. Never recreate/update this group from
// source control or return its email addresses in deployment outputs.
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' existing = {
  name: '${vmName}-operators'
}
// RawData is one JSON record per line. Freshness uses the producer timestamp,
// so replaying buffered records after an outage cannot look like recovery.
var healthBase = '''
TrueCourseHealth_CL
| where Computer =~ '__VM__' and TimeGenerated > ago(30m)
| extend health = parse_json(RawData)
| extend observed = todatetime(health.timestamp)
'''
var currentHealth = '''
__BASE__
| where observed > ago(10m)
| summarize arg_max(observed, *)
| where isnotnull(observed)
'''
var healthQuery = replace(healthBase, '__VM__', vmName)
var latestHealthQuery = replace(currentHealth, '__BASE__', healthQuery)
var activeHealthQuery = '${latestHealthQuery}\n| where coalesce(tobool(health.maintenance), false) == false'
var alerts = [
  {
    name: 'health-missing'
    description: 'No fresh TrueCourse health record for 10 minutes. Check VM, health timer, and Azure Monitor Agent.'
    severity: 1
    query: '${healthQuery}\n| summarize lastSeen=max(observed)\n| where isnull(lastSeen) or lastSeen < ago(10m)'
  }
  {
    name: 'maintenance-too-long'
    description: 'Maintenance has exceeded one hour or has no valid start timestamp. Inspect the release operation and service before resuming jobs.'
    severity: 1
    query: '${latestHealthQuery}\n| where tobool(health.maintenance) == true\n| extend maintenanceStart=todatetime(health.maintenanceSince)\n| where isnull(maintenanceStart) or maintenanceStart < ago(1h)'
  }
  {
    name: 'application-unhealthy'
    description: 'Latest application health check failed outside maintenance. Check service logs and database connectivity.'
    severity: 1
    query: '${activeHealthQuery}\n| where coalesce(tobool(health.healthy), false) == false'
  }
  {
    name: 'jobs-failed'
    description: 'At least one job failed in the previous 15 minutes. Inspect job and application logs.'
    severity: 2
    query: '${activeHealthQuery}\n| where toint(health.failures) > 0'
  }
  {
    name: 'jobs-stalled'
    description: 'At least one active job has exceeded the configured one-hour age threshold. Inspect before cancelling.'
    severity: 2
    query: '${activeHealthQuery}\n| where toint(health.stalledJobs) > 0'
  }
  {
    name: 'memory-high'
    description: 'Average used memory exceeds 90 percent over 15 minutes.'
    severity: 2
    query: 'Perf | where Computer =~ "${vmName}" and ObjectName == "Memory" and CounterName == "% Used Memory" | summarize used=avg(CounterValue) | where used > 90'
  }
  {
    name: 'disk-low'
    description: 'Average disk free space below 15 percent over 15 minutes. Inspect Docker storage and repository workspaces.'
    severity: 1
    query: 'Perf | where Computer =~ "${vmName}" and ObjectName == "Logical Disk" and CounterName == "% Free Space" | summarize free=avg(CounterValue) by InstanceName | where free < 15'
  }
]
resource logAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for alert in alerts: {
  name: '${vmName}-${alert.name}'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: '${vmName}: ${alert.name}'
    description: alert.description
    enabled: enabled
    severity: alert.severity
    scopes: [workspace.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    // A new table may not yet be queryable during this deployment. Validate
    // actual collection and queries before enabling alerts at cutover.
    skipQueryValidation: true
    criteria: {
      allOf: [{
        query: alert.query
        timeAggregation: 'Count'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { minFailingPeriodsToAlert: 1, numberOfEvaluationPeriods: 1 }
      }]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
  dependsOn: [collection]
}]
resource cpuAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${vmName}-cpu-high'
  location: 'global'
  tags: tags
  properties: {
    description: 'Average VM CPU exceeds 90 percent over 15 minutes.'
    severity: 2
    enabled: enabled
    scopes: [vm.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        criterionType: 'StaticThresholdCriterion'
        name: 'cpu'
        metricNamespace: 'Microsoft.Compute/virtualMachines'
        metricName: 'Percentage CPU'
        operator: 'GreaterThan'
        threshold: 90
        timeAggregation: 'Average'
      }]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}

// PostgreSQL storage auto-growth remains disabled. These platform metrics alert
// independently of VM health and require no agent or database configuration.
// https://learn.microsoft.com/azure/postgresql/monitor/concepts-monitoring
var databaseThresholds = [
  {
    name: 'storage-high'
    metric: 'storage_percent'
    threshold: 85
    severity: 1
    description: 'Managed PostgreSQL storage exceeds 85 percent over 15 minutes. Auto-growth is disabled; investigate usage and arrange a reviewed capacity increase.'
  }
  {
    name: 'cpu-high'
    metric: 'cpu_percent'
    threshold: 90
    severity: 2
    description: 'Managed PostgreSQL CPU exceeds 90 percent over 15 minutes. Inspect query load and burstable CPU credits.'
  }
]
resource databaseAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for alert in databaseThresholds: {
  name: '${vmName}-postgres-${alert.name}'
  location: 'global'
  tags: tags
  properties: {
    description: alert.description
    severity: alert.severity
    enabled: enabled
    scopes: [database.id]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{
        criterionType: 'StaticThresholdCriterion'
        name: alert.name
        metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
        metricName: alert.metric
        operator: 'GreaterThan'
        threshold: alert.threshold
        timeAggregation: 'Average'
      }]
    }
    actions: [{ actionGroupId: actionGroup.id }]
  }
}]
