// process.env bracket access — idiomatic convention for runtime environment lookups
function getWebhookBypassHosts(): string[] {
  const bypassHostsRaw = process.env['APP_PRIVATE_WEBHOOK_BYPASS_HOSTS'];
  if (!bypassHostsRaw) {
    return [];
  }
  return bypassHostsRaw.split(',').map((h) => h.trim());
}

function isWebhookUrlAllowed(url: string): boolean {
  const allowList = process.env['APP_WEBHOOK_ALLOW_LIST'];
  return allowList ? allowList.split(',').includes(url) : true;
}
