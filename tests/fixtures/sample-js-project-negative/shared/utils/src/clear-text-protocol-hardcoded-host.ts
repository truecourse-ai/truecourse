/**
 * A hardcoded plaintext URL passed straight to fetch — credentials and
 * payload would travel over an unencrypted channel.
 */

declare function fetch(url: string): Promise<Response>;

export async function postAuditEvent(payload: Record<string, unknown>): Promise<Response> {
  // VIOLATION: security/deterministic/clear-text-protocol
  return fetch('http://audit.example.com/events');
}

export async function fetchExternalConfig(): Promise<Response> {
  // VIOLATION: security/deterministic/clear-text-protocol
  return fetch(`http://config.example.com/v1/settings?ts=${Date.now()}`);
}
