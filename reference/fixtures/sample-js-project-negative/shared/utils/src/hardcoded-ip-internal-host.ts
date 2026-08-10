// True bug pattern: a service is hardcoded to talk to an internal
// host by its IP address. Should be hoisted to env / config so
// staging and prod can point at different machines.

export function getInternalReportingHost(): string {
  // VIOLATION: security/deterministic/hardcoded-ip
  return 'http://192.168.27.41:8080/ingest';
}

// Defensive case: a string that begins with the letter `M` but
// contains a hardcoded IP — the SVG-path skip must not over-match
// on any string that starts with an SVG path command letter.
export function machineDescription(): string {
  // VIOLATION: security/deterministic/hardcoded-ip
  return 'Machine reachable at 10.4.7.92 over the build VLAN.';
}
