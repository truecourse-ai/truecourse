/**
 * Credential redaction for api-driver evidence. A resolved credential value can
 * reach a transcript any number of ways — the service echoes the header, a 500
 * logs the request, the failure excerpt carries the response body — so the runner
 * masks every resolved secret out of ALL evidence text and failure output at the
 * write boundary, replacing it with a stable `«cred:<name>»` token that names the
 * credential without revealing it.
 */

/**
 * Build a redactor that masks every resolved credential value as `«cred:<name>»`.
 * For each secret it masks BOTH the raw value and its JSON-escaped form (the way it
 * appears inside `invocation.json` or a JSON response body — `"`→`\"`, non-ASCII→
 * `\uXXXX`), so a quote- or unicode-bearing secret cannot slip through the JSON
 * transcripts. Longer needles are masked first so a secret that is a prefix of
 * another cannot leak through; empty values (nothing to hide) are skipped. Returns
 * the identity function when nothing is resolved, so a credential-less run is untouched.
 */
export function buildCredentialRedactor(
  credentials: ReadonlyMap<string, string>,
  /**
   * Non-credential secrets that must be masked too, keyed by a label that names
   * them without revealing them. Today: the env values of a PROVIDED external API
   * account (item 62), labelled `<service>.<VAR>` and masked `«external:…»` — an
   * app forwards its upstream key, and a stub transcript or a 500 would otherwise
   * carry it into evidence.
   */
  externalSecrets?: ReadonlyMap<string, string>,
): (text: string) => string {
  const needles: { needle: string; mask: string }[] = []
  const push = (value: string, mask: string): void => {
    if (value.length === 0) return
    needles.push({ needle: value, mask })
    const escaped = JSON.stringify(value).slice(1, -1)
    if (escaped !== value) needles.push({ needle: escaped, mask })
  }
  for (const [name, value] of credentials) push(value, `«cred:${name}»`)
  for (const [label, value] of externalSecrets ?? []) push(value, `«external:${label}»`)
  if (needles.length === 0) return (text) => text
  needles.sort((a, b) => b.needle.length - a.needle.length)
  return (text) => {
    let out = text
    for (const { needle, mask } of needles) out = out.split(needle).join(mask)
    return out
  }
}
