import { afterAll } from 'vitest'
import {
  openRoslynHost,
  resolveRoslynHostBinary,
  type RoslynHostSession,
} from '../../packages/analyzer/src/roslyn-host-client'

/**
 * The Roslyn rule suites exercise the real .NET semantic host. They run only when
 * it's been built (`dotnet build -c Release tools/csharp-roslyn-host`).
 */
export const roslynHostBuilt = resolveRoslynHostBinary() !== null

/** Per-snippet queries against a host held open for the whole test file. */
export interface RoslynRuleHost {
  /** Rule keys the host reports for `text`, scoped to `ruleKey`. */
  keys(text: string, ruleKey: string): Promise<string[]>
  /** Violation messages for `text`, scoped to `ruleKey` (for asserting the subject). */
  messages(text: string, ruleKey: string): Promise<string[]>
}

/**
 * Open one host process for the calling test file, closed automatically when the
 * file finishes. Every snippet is still its own `analyze` request — and so its own
 * Roslyn compilation — so results are identical to spawning per assertion; only
 * the ~0.8s process boot is shared. With ~450 rule assertions that is the
 * difference between ~6 minutes of process startup and one.
 *
 * Call at file top level, next to the `describe`s that use it.
 */
export function useRoslynHost(): RoslynRuleHost {
  let session: RoslynHostSession | undefined
  // Lazily opened: a file whose suites are skipped (no host built) never spawns.
  const analyze = (text: string, ruleKey: string) => {
    session ??= openRoslynHost()
    return session.analyze([{ path: 'Test.cs', text }], [ruleKey])
  }

  afterAll(async () => {
    await session?.close()
    session = undefined
  })

  return {
    async keys(text, ruleKey) {
      return (await analyze(text, ruleKey)).map((v) => v.ruleKey)
    },
    async messages(text, ruleKey) {
      return (await analyze(text, ruleKey)).map((v) => v.message)
    },
  }
}
