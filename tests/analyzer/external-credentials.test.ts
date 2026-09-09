import { describe, it, expect } from 'vitest'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { detectExternalServices } from '../../packages/analyzer/src/external-services'
import { DetectedExternalServiceSchema, FileAnalysisSchema } from '../../packages/shared/src/index'

const analyze = (source: string, path = '/repo/provider.ts') => analyzeFileContent(path, source, 'typescript')
const detect = (source: string) => detectExternalServices([analyze(source)])
const names = (source: string) => detect(source).flatMap(s => s.credentialEnvs?.map(c => [s.service, c.envVar]) ?? [])
const call = (header: string, url = "'https://api.currencybeacon.com/v1/latest'") => `fetch(${url}, { headers: { Authorization: ${header} } })`

describe('outbound credential environment detection', () => {
  it('traces the expense-tracker env → alias → header → URL chain, without storing values', () => {
    const source = `async function convert() {
      const apiKey = process.env.CURRENCYBEACON_API_KEY?.trim();
      if (!apiKey) throw new Error('missing key');
      const base = process.env.CURRENCYBEACON_BASE_URL ?? 'https://api.currencybeacon.com';
      let url: URL;
      try { url = new URL(base); url.pathname = '/v1/latest'; } catch { throw new Error('bad URL'); }
      return fetch(url, { headers: { Authorization: \`Bearer \${apiKey}\`, Accept: 'application/json' } });
    }`
    const file = analyze(source)
    expect(FileAnalysisSchema.parse(file).externalCredentialRefs).toHaveLength(1)
    const service = DetectedExternalServiceSchema.parse(detectExternalServices([file])[0])
    expect(service).toMatchObject({ service: 'currencybeacon', baseUrlEnv: 'CURRENCYBEACON_BASE_URL', credentialEnvs: [{ envVar: 'CURRENCYBEACON_API_KEY', evidence: [{ filePath: '/repo/provider.ts', line: 7, header: 'authorization' }] }] })
    expect(JSON.stringify(service.credentialEnvs)).not.toContain('Bearer')
  })

  it('binds each header to its own destination, not similarly named variables or other calls', () => {
    expect(names(`
      const CURRENCYBEACON_API_KEY = process.env.UNUSED_KEY;
      ${call('process.env.UNRELATED_NAME')};
      fetch('https://api.stripe.com/v1', {headers: {'X-API-Key': process.env.CURRENCYBEACON_KEY}});
      ${call("'literal-secret-never-recorded'")};
    `)).toEqual([['currencybeacon', 'UNRELATED_NAME'], ['stripe', 'CURRENCYBEACON_KEY']])
  })

  it('supports bracket env reads, const aliases, object options and header concatenation', () => {
    expect(names(`const token = process.env['REAL_KEY']; const auth = 'Bearer ' + token;
      const headers = { 'api-key': auth }; const options = { headers: headers };
      fetch('https://api.currencybeacon.com', options);`)).toEqual([['currencybeacon', 'REAL_KEY']])
  })

  it('does not turn configuration, unused variables, comments or inbound headers into credentials', () => {
    expect(names(`// process.env.COMMENT_API_KEY
      const key = process.env.UNUSED_KEY;
      fetch('https://api.currencybeacon.com', {headers: {Accept: process.env.ACCEPT, 'X-Region': process.env.REGION}});
      ${call('request.headers.authorization')};`)).toEqual([])
  })

  it.each([
    `function run(key: string) { ${call('key')} }`,
    `function run() { const key = 'local'; ${call('key')} }`,
    `function run() { if (true) { var key = 'local'; } ${call('key')} }`,
    `function run(process: unknown) { ${call('process.env.OUTER_KEY')} }`,
    `function run(fetch: Function) { ${call('key')} }`,
    `const run = function fetch() { ${call('key')} }`,
    `const run = function process() { ${call('process.env.KEY')} }`,
    `const fetch = customClient; ${call('key')}`,
    `key = otherToken; ${call('key')}`,
    `${call('wrap(key)')}`,
    `${call("key ?? 'optional-default'")}`,
    `${call('key', 'unknownDestination')}`,
    `${call('key', "flag ? 'https://api.currencybeacon.com' : 'https://api.stripe.com'")}`,
    `${call('key', "new URL('http://localhost:3000', 'https://api.currencybeacon.com')")}`,
    `${call('key', "new URL('//localhost:3000', 'https://api.currencybeacon.com')")}`,
    `const options = { headers: { Authorization: key } }; options.headers.Authorization = 'other'; fetch('https://api.currencybeacon.com', options);`,
    `fetch('https://api.currencybeacon.com', {headers: {Authorization: key, ...unknownHeaders}})`,
    `fetch('https://api.currencybeacon.com', {headers: {Authorization: key}, ...unknownOptions})`,
  ])('leaves ambiguous or shadowed sources unresolved: %s', body => {
    expect(names(`let key = process.env.OUTER_KEY; ${body}`)).toEqual([])
  })

  it('does not attach an owned host to a vendor with the same registrable domain', () => {
    const file = analyze(`const docs = 'https://currencybeacon.com'; ${call('process.env.KEY')}`)
    expect(detectExternalServices([file], {ownHosts: ['api.currencybeacon.com']})[0]?.credentialEnvs).toBeUndefined()
  })

  it('deduplicates names and retains stable call-site evidence across file ordering', () => {
    const a = analyze(call('process.env.KEY'), '/repo/a.ts')
    const b = analyze(call('process.env.KEY'), '/repo/b.ts')
    expect(detectExternalServices([a, b])).toEqual(detectExternalServices([b, a]))
    expect(detectExternalServices([a, b])[0]?.credentialEnvs?.[0]?.evidence).toHaveLength(2)
  })

  it('joins a resolved origin env to a literal default in another analyzed file', () => {
    const config = analyze("const base = process.env.PROVIDER_URL ?? 'https://api.currencybeacon.com'", '/repo/config.ts')
    const request = analyze(call('process.env.KEY', "new URL('/v1/latest', process.env.PROVIDER_URL)"))
    expect(detectExternalServices([config, request])[0]?.credentialEnvs?.[0]?.envVar).toBe('KEY')
  })

  it('keeps legacy detection snapshots readable without new metadata', () => {
    expect(DetectedExternalServiceSchema.parse({service: 'stripe', evidence: []})).toEqual({service: 'stripe', evidence: []})
  })
})
