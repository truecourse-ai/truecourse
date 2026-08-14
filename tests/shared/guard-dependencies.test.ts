/**
 * The dependency-catalog SHAPES: what a catalog file may say, what it may not, and
 * the two derivations every surface reads — the flow-contributed requirement rolled
 * up per entry, and the `${supplied:…}` token a scenario reaches an instance with.
 */
import { describe, it, expect } from 'vitest'
import {
  GuardDependenciesFileSchema,
  GuardDependenciesLocalSchema,
  GuardDependencyEntrySchema,
  isSecretHeaderName,
  rollUpRequirement,
  suppliedNamesIn,
  suppliedTokenRefs,
  type GuardDependencyEntry,
} from '../../packages/shared/src/index'

const supplied = (over: Partial<GuardDependencyEntry> = {}): unknown => ({
  name: 'analysis-target',
  class: 'supplied',
  summary: 'a real project for the CLI to analyze',
  registration: { kind: 'path', description: 'path to a checked-out project' },
  ...over,
})

describe('the dependency catalog schema', () => {
  it('accepts a supplied entry with conditionality and contributed needs', () => {
    const parsed = GuardDependencyEntrySchema.parse(
      supplied({
        condition: {
          predicates: [{ kind: 'config-value', key: 'llm.transport', value: 'api' }],
          sentence: 'only when the LLM transport is `api`',
        },
        needs: [{ flowId: 'f1', need: 'a project with one high finding' }],
      }),
    )
    expect(parsed.class).toBe('supplied')
    expect(parsed.needs).toHaveLength(1)
  })

  // The registration IS the "how do I clear this" half. A supplied entry without one
  // is a gap nobody can close, which is exactly what the catalog exists to prevent.
  it('refuses a supplied entry with no registration shape', () => {
    const result = GuardDependencyEntrySchema.safeParse(supplied({ registration: undefined }))
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('how an instance is registered')
  })

  // step-creatable / seedable state is obtained by the scenario or the runner. A
  // registration or a contributed need on one of them would promise a user action
  // that nothing ever asks for.
  it('refuses registration or needs on a non-supplied entry', () => {
    expect(
      GuardDependenciesFileSchema.safeParse({
        dependencies: [
          { name: 'a-repo', class: 'step-creatable', summary: 'a git repo', registration: { kind: 'path', description: 'x' } },
        ],
      }).success,
    ).toBe(false)
    expect(
      GuardDependenciesFileSchema.safeParse({
        dependencies: [
          { name: 'a-repo', class: 'seedable', summary: 'a git repo', needs: [{ flowId: 'f', need: 'x' }] },
        ],
      }).success,
    ).toBe(false)
  })

  /**
   * A variable the program has a working default for. The flag is additive in both
   * directions: an unflagged variable stays required AND stays unflagged on the way
   * back out, so declaring one optional never rewrites the rest of a committed file.
   */
  it('carries an OPTIONAL env variable, and reads an unflagged one as required', () => {
    const parsed = GuardDependencyEntrySchema.parse(
      supplied({
        registration: {
          kind: 'env',
          vars: [
            { name: 'api-key', description: 'a key for that provider', secret: true },
            {
              name: 'base-url',
              description: 'the provider API base URL — omit for the provider default',
              secret: false,
              optional: true,
            },
          ],
        },
      }),
    )
    const registration = parsed.registration!
    expect(registration.kind).toBe('env')
    if (registration.kind !== 'env') return
    expect(registration.vars.map((v) => v.optional)).toEqual([undefined, true])

    const round = GuardDependencyEntrySchema.parse(JSON.parse(JSON.stringify(parsed)))
    expect(round).toEqual(parsed)
    expect(JSON.stringify(round)).not.toContain('"optional":false')
  })

  /**
   * The service link is a LIST: one class of starting state routinely stands for
   * several third parties (one provider-API credential for four model providers),
   * and every one of them has to fold into the single thing a user registers.
   */
  it('carries every external-service identity an entry stands for', () => {
    const parsed = GuardDependencyEntrySchema.parse(
      supplied({ services: ['anthropic', 'openai', 'aws-bedrock', 'githubcopilot'] }),
    )
    expect(parsed.services).toEqual(['anthropic', 'openai', 'aws-bedrock', 'githubcopilot'])

    const round = GuardDependencyEntrySchema.parse(JSON.parse(JSON.stringify(parsed)))
    expect(round).toEqual(parsed)
    // An empty list is not "stands for nothing" — it is a declaration that says
    // nothing, and an entry that names no service simply omits the field.
    expect(GuardDependencyEntrySchema.safeParse(supplied({ services: [] })).success).toBe(false)
  })

  /**
   * A catalog is committed in a user's repository, so the pre-list spelling has to
   * keep loading — as the same entry with a one-element list, never as an entry that
   * names no service at all.
   */
  it('reads a legacy single `service` as a one-element `services`', () => {
    const parsed = GuardDependencyEntrySchema.parse({ ...(supplied() as object), service: 'claude' })
    expect(parsed.services).toEqual(['claude'])
    expect(parsed).not.toHaveProperty('service')

    // A whole file of them, and the list spelling wins where a file carries both.
    const file = GuardDependenciesFileSchema.parse({
      dependencies: [
        { ...(supplied() as object), service: 'claude' },
        { ...(supplied({ name: 'other' }) as object), service: 'stripe', services: ['stripe', 'adyen'] },
      ],
    })
    expect(file.dependencies.map((d) => d.services)).toEqual([['claude'], ['stripe', 'adyen']])
  })

  it('refuses two entries with the same name — the name is the binding identity', () => {
    const result = GuardDependenciesFileSchema.safeParse({
      dependencies: [supplied(), supplied()],
    })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('duplicate dependency name')
  })

  it('rejects a free-form conditionality predicate — the vocabulary is closed', () => {
    expect(
      GuardDependencyEntrySchema.safeParse(
        supplied({
          condition: {
            predicates: [{ kind: 'vibes', because: 'it feels right' }],
            sentence: 'sometimes',
          },
        } as never),
      ).success,
    ).toBe(false)
  })

  it('keeps the local overlay to instances only — a path and declared values', () => {
    expect(
      GuardDependenciesLocalSchema.parse({
        'analysis-target': { path: '/home/dev/fixture' },
        'llm-api-credentials': { env: { 'api-key': 'sk-x' } },
      }),
    ).toEqual({
      'analysis-target': { path: '/home/dev/fixture' },
      'llm-api-credentials': { env: { 'api-key': 'sk-x' } },
    })
    // No declarations in the overlay: it can never introduce a capability the team
    // cannot see in the committed file.
    expect(
      GuardDependenciesLocalSchema.safeParse({ x: { class: 'supplied' } }).success,
    ).toBe(false)
  })

  /**
   * The TRANSPORT half of an external-service instance. It is the one thing here
   * the committed catalog does not declare, and deliberately: a bearer token and a
   * tenant header are how ONE machine addresses an account, never a capability
   * teammates inherit.
   */
  it('carries the account’s token and headers — and only header names HTTP allows', () => {
    expect(
      GuardDependenciesLocalSchema.parse({
        stripe: { token: 'sk_test_1', headers: { 'X-Tenant': 'acme' } },
      }),
    ).toEqual({ stripe: { token: 'sk_test_1', headers: { 'X-Tenant': 'acme' } } })

    const bad = GuardDependenciesLocalSchema.safeParse({
      stripe: { headers: { 'X Tenant: nope': 'acme' } },
    })
    expect(bad.success).toBe(false)
  })
})

/**
 * Which header names carry a credential. The rule fails CLOSED — it is the guard
 * against echoing a stored secret back to a page, and the cost of judging one
 * wrongly is a value a reader retypes, never a value that leaks.
 */
describe('isSecretHeaderName', () => {
  it('calls a credential-shaped header a secret, whatever case it is written in', () => {
    for (const name of ['Authorization', 'x-api-key', 'X-Session-Token', 'Cookie', 'X-Signature']) {
      expect(isSecretHeaderName(name), name).toBe(true)
    }
  })

  it('leaves a plainly descriptive header readable', () => {
    for (const name of ['X-Tenant', 'Accept', 'X-Request-Id', 'User-Agent']) {
      expect(isSecretHeaderName(name), name).toBe(false)
    }
  })
})

describe('rollUpRequirement — the requirement is contributed, flow by flow', () => {
  const entry = GuardDependencyEntrySchema.parse(
    supplied({
      needs: [
        { flowId: 'claude', need: 'one high- and one low-severity finding' },
        { flowId: 'api', need: 'at least one file the LLM rules accept' },
      ],
    }),
  )

  it('joins every contributing flow’s need, attributed', () => {
    const rolled = rollUpRequirement(entry)
    expect(rolled.needs.map((n) => n.flowId)).toEqual(['claude', 'api'])
    expect(rolled.sentence).toBe(
      'one high- and one low-severity finding; at least one file the LLM rules accept',
    )
  })

  it('drops a dismissed flow’s need — its expectation died with the flow', () => {
    const rolled = rollUpRequirement(entry, new Set(['api']))
    expect(rolled.needs.map((n) => n.flowId)).toEqual(['claude'])
    expect(rolled.sentence).toBe('one high- and one low-severity finding')
  })

  // Never blank: an entry no flow has contributed to yet (or whose flows are all
  // dismissed) still has to tell a user what it is.
  it('falls back to the entry summary when nothing contributes', () => {
    expect(rollUpRequirement(entry, new Set(['claude', 'api'])).sentence).toBe(
      'a real project for the CLI to analyze',
    )
  })
})

describe('the ${supplied:…} token', () => {
  it('reads name and field, deduped, in first-seen order', () => {
    expect(
      suppliedTokenRefs('${supplied:creds.api-key} then ${supplied:target.path} then ${supplied:creds.api-key}'),
    ).toEqual([
      { name: 'creds', field: 'api-key' },
      { name: 'target', field: 'path' },
    ])
  })

  it('finds every referenced dependency anywhere in a nested structure', () => {
    expect(
      suppliedNamesIn({
        setup: { env: { KEY: '${supplied:creds.api-key}' } },
        steps: [{ run: ['analyze', '${supplied:target.path}'] }],
      }),
    ).toEqual(['creds', 'target'])
  })

  // A `setup.files` / `expect.files` KEY is a path the runner interpolates, so a
  // token there is a real binding — missing it would bypass the blocked gate and
  // let the literal token reach resolution mid-run.
  it('finds a reference that only appears in an object KEY', () => {
    expect(
      suppliedNamesIn({
        setup: { files: { '${supplied:proj.path}/config.yaml': 'strict: true' } },
      }),
    ).toEqual(['proj'])
    expect(
      suppliedNamesIn({
        steps: [{ run: ['ls'], expect: { files: { '${supplied:proj.path}/out.txt': { exists: true } } } }],
      }),
    ).toEqual(['proj'])
  })

  it('does not mistake a sandbox or unique token for a supplied one', () => {
    expect(suppliedNamesIn({ a: '${sandbox}/x', b: 'name-${unique}' })).toEqual([])
  })
})

describe('a config-dir homePath', () => {
  const configDir = (homePath: string): unknown =>
    supplied({ registration: { kind: 'config-dir', homePath, description: 'a login dir' } })

  it('accepts a HOME-relative destination', () => {
    expect(GuardDependencyEntrySchema.safeParse(configDir('.claude')).success).toBe(true)
    expect(GuardDependencyEntrySchema.safeParse(configDir('.config/app/deep')).success).toBe(true)
  })

  // The catalog is committed, so homePath is repo-supplied input to every machine
  // that runs it — a traversal would aim the recursive copy at the developer's
  // real filesystem.
  it('refuses an absolute path or a traversal out of HOME', () => {
    for (const bad of ['/etc', '../../../.ssh', '.claude/../../escape', 'C:\\Users']) {
      expect(GuardDependencyEntrySchema.safeParse(configDir(bad)).success).toBe(false)
    }
  })
})
