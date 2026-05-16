
function normalizeHostname(rawHost: string): string {
  const hostname = rawHost.toLowerCase();
  // Strip IPv6 brackets if present
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return bare.replace(/\.+$/, '');
}
