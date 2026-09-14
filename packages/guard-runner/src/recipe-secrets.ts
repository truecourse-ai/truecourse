/** Shared list of inline credential carriers used by recipe masking and fingerprints. */
export function forEachInlineSecret(parsed: unknown, visit: (holder: Record<string, unknown>) => void): void {
  const api = (parsed as {
    api?: {
      credentials?: Record<string, unknown>
      externals?: Record<string, { env?: Record<string, unknown> } | null>
    }
  })?.api
  const externals = api?.externals
  if (externals && typeof externals === 'object') {
    for (const external of Object.values(externals)) {
      const env = external?.env
      if (!env || typeof env !== 'object') continue
      for (const entry of Object.values(env)) {
        if (entry && typeof entry === 'object' && 'value' in entry) {
          visit(entry as Record<string, unknown>)
        }
      }
    }
  }
  const creds = api?.credentials
  if (creds && typeof creds === 'object') {
    for (const cred of Object.values(creds)) {
      if (cred && typeof cred === 'object' && 'value' in cred) {
        visit(cred as Record<string, unknown>)
      }
    }
  }
}

