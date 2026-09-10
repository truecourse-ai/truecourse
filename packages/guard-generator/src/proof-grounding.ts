import type { GuardVerification } from '@truecourse/shared'

/** Exact invocation evidence only. The current runner chooses an isolated port. */
export function invocationProofGap(
  invocation: NonNullable<NonNullable<GuardVerification['cases']>[number]['invocation']>,
  serve: readonly string[],
): string | undefined {
  if (invocation.command !== serve.join(' '))
    return `The executor runs ${serve.join(' ') || 'no configured command'}; it cannot prove the required invocation ${invocation.command}.`
  if (invocation.address)
    return `The executor allocates an isolated port; it cannot prove the documented fixed address ${invocation.address}.`
  return undefined
}

/** Query state needs an observed interface or a documented URL contract. */
export function navigationGroundingProblem(
  url: string,
  interfacePaths: readonly string[],
  source: string,
): string | undefined {
  if (!url.includes('?')) return undefined
  const parsed = new URL(url, 'http://guard.invalid')
  const queryKeys = [...parsed.searchParams.keys()]
  const grounded = interfacePaths.some((path) => {
    const known = new URL(path, 'http://guard.invalid')
    return known.pathname === parsed.pathname && queryKeys.every((key) => known.searchParams.has(key))
  })
  if (grounded || source.includes(url)) return undefined
  return `Navigation ${url} introduces an undocumented query trigger. Use a mapped or documented action that actually reaches the required condition; retain a mapping gap if none exists.`
}
