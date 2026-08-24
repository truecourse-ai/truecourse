/**
 * EXTERNAL SERVICES DETECTED FROM PLAIN HTTP.
 *
 * The motivating repo is `speced-api`: no SDK anywhere, an upstream reached with a
 * bare `fetch`, and both of its base URLs written as defaults in one config module.
 * The import-registry detector finds NOTHING there. The acceptance below is the
 * shape of that repo's config, and it must yield exactly ONE service — the vendor,
 * not its two hostnames — carrying BOTH override variables with their default URLs.
 */

import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractExternalHttp } from '../../packages/analyzer/src/extractors/external-http';
import {
  detectExternalServices,
  deriveOwnHosts,
  registrableDomain,
  serviceNameFromDomain,
} from '../../packages/analyzer/src/external-services';
import type { CallExpression, FileAnalysis } from '../../packages/shared/src/types/analysis';

function extract(code: string, filePath = '/repo/src/config.ts') {
  return extractExternalHttp(parseCode(code, 'typescript'), filePath, 'typescript');
}

/** A FileAnalysis carrying only what one source file's HTTP pass produced. */
function analyzed(filePath: string, code: string, imports: string[] = []): FileAnalysis {
  const { refs, urlEnvReads } = extract(code, filePath);
  return {
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: imports.map((source) => ({
      source,
      specifiers: [{ name: 'default', alias: undefined, isDefault: true, isNamespace: false }],
      isTypeOnly: false,
    })),
    exports: [],
    calls: [] as CallExpression[],
    httpCalls: [],
    ...(refs.length > 0 ? { externalHttpRefs: refs } : {}),
    ...(urlEnvReads.length > 0 ? { urlEnvReads } : {}),
  };
}

/** The `speced-api` config module, reduced to the shape that matters. */
const SPECED_API_CONFIG = `
  const DEFAULTS = {
    PORT: 8080,
    UPSTREAM_TIMEOUT_MS: 5000,
    GEOCODING_BASE_URL: 'https://geocoding-api.open-meteo.com',
    FORECAST_BASE_URL: 'https://api.open-meteo.com',
  } as const;

  function readUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    return raw.replace(/\\/+$/, '');
  }

  export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
    return {
      geocodingBaseUrl: readUrl(env, 'GEOCODING_BASE_URL', DEFAULTS.GEOCODING_BASE_URL),
      forecastBaseUrl: readUrl(env, 'FORECAST_BASE_URL', DEFAULTS.FORECAST_BASE_URL),
    };
  }
`;

describe('extractExternalHttp — the URL harvest', () => {
  it('keeps http(s) literals with a real host, in string and template form', () => {
    const { refs } = extract(`
      const a = 'https://api.stripe.com/v1';
      const b = \`https://hooks.slack.com/services/\${token}\`;
      const c = \`\${base}/v1/search\`;
      const d = '/v1/relative';
      const e = \`https://console.cal.com\`;
    `);

    expect(refs.map((r) => [r.host, r.url])).toEqual([
      ['api.stripe.com', 'https://api.stripe.com/v1'],
      // The template contributes its HEAD — enough to name the host.
      ['hooks.slack.com', 'https://hooks.slack.com/services/'],
      // An UNinterpolated template sheds its closing backtick — a host ending in
      // a backtick would dodge ownHosts matching and domain grouping.
      ['console.cal.com', 'https://console.cal.com'],
    ]);
  });

  it('drops the hosts that are never a third party', () => {
    const { refs } = extract(`
      const urls = [
        'http://localhost:3000/health',
        'http://127.0.0.1:8080',
        'https://api.example.com/v1',
        'https://db.internal/query',
        'https://cache.local',
        'https://svc.test/api',
        'http://www.w3.org/2000/svg',
        'https://json-schema.org/draft/2020-12/schema',
        'https://redis:6379',
      ];
    `);

    expect(refs).toEqual([]);
  });

  it('can be told which hosts the repo OWNS — its own origin is not a dependency', () => {
    const files = [analyzed('/repo/src/links.ts', `const home = 'https://app.acme.com/dashboard';`)];

    expect(detectExternalServices(files).map((s) => s.service)).toEqual(['acme']);
    expect(detectExternalServices(files, { ownHosts: ['acme.com'] })).toEqual([]);
  });
});

/**
 * `deriveOwnHosts` — turning what the CALLER knows (its recipe) into the
 * `ownHosts` answer above. The motivating repo is cal.com: its tree writes its own
 * production URLs as env-var fallbacks (`NEXT_PUBLIC_WEBAPP_URL` →
 * `https://app.cal.com`), which detection read as a third party named `cal` that
 * "blocked" 32 flows on the app itself.
 */
describe('deriveOwnHosts', () => {
  it('normalizes declared entries — bare host, full URL, port, case', () => {
    expect(
      deriveOwnHosts([], {
        declaredHosts: ['cal.com', 'https://App.Acme.io/dashboard?x=1', 'staging.acme.io:8443', '  '],
      }),
    ).toEqual(['app.acme.io', 'cal.com', 'staging.acme.io']);
  });

  it('widens a controlled env var\'s URL fallback to its registrable domain', () => {
    const files = [
      analyzed(
        '/repo/src/config.ts',
        `const base = process.env.NEXT_PUBLIC_WEBAPP_URL ?? 'https://app.cal.com';`,
      ),
    ];

    expect(deriveOwnHosts(files, { controlledEnvVars: ['NEXT_PUBLIC_WEBAPP_URL'] })).toEqual([
      'cal.com',
    ]);
    // A variable the caller does NOT control proves nothing about ownership.
    expect(deriveOwnHosts(files, { controlledEnvVars: ['DATABASE_URL'] })).toEqual([]);
    // A ref with no env association never contributes — the URL is just a link.
    const bare = [analyzed('/repo/src/links.ts', `const home = 'https://cal.com/pricing';`)];
    expect(deriveOwnHosts(bare, { controlledEnvVars: ['NEXT_PUBLIC_WEBAPP_URL'] })).toEqual([]);
  });

  /**
   * The sharper invariant, and independent of `ownHosts`: a marketing/SEO module
   * writes the product's own domain as an ordinary literal in an ordinary file, with
   * no env var and no recipe declaration to derive ownership from. Detection turned
   * `https://truecourse.dev` into a service named after the product, which the
   * blocked-on canonicalizer then attached every refusal mentioning the product to —
   * the app rendered as a SaaS the user had forgotten to configure.
   */
  it('never turns the repo’s OWN product into a third party', () => {
    const files = [
      analyzed(
        '/repo/apps/landing/src/lib/seo.ts',
        `
          export const SITE_URL = 'https://truecourse.dev';
          export const seo = {
            canonical: SITE_URL,
            ogImage: 'https://truecourse.dev/og.png',
            twitter: 'https://x.com/truecourseai',
          };
        `,
      ),
    ];

    expect(detectExternalServices(files).map((s) => s.service)).toEqual(['truecourse', 'x']);
    // The identity as the resolver states it, and as a domain — both are the product.
    expect(detectExternalServices(files, { ownProductNames: ['truecourse'] }).map((s) => s.service)).toEqual(['x']);
    expect(detectExternalServices(files, { ownProductNames: ['truecourse.dev'] }).map((s) => s.service)).toEqual(['x']);
    // Every subdomain of the product's domain goes with it.
    const docs = [analyzed('/repo/src/help.ts', `const help = 'https://docs.truecourse.dev/guard';`)];
    expect(detectExternalServices(docs, { ownProductNames: ['TrueCourse'] })).toEqual([]);
  });

  it('feeds detection: the self-service disappears, the real third party stays', () => {
    const files = [
      analyzed(
        '/repo/src/config.ts',
        `
          const webapp = process.env.NEXT_PUBLIC_WEBAPP_URL ?? 'https://app.cal.com';
          const consoleUrl = 'https://console.cal.com/teams';
          const stripe = 'https://api.stripe.com/v1';
        `,
      ),
    ];

    expect(detectExternalServices(files).map((s) => s.service)).toEqual(['cal', 'stripe']);
    const ownHosts = deriveOwnHosts(files, { controlledEnvVars: ['NEXT_PUBLIC_WEBAPP_URL'] });
    // The widened domain covers every subdomain the tree mentions, not just the fallback's.
    expect(detectExternalServices(files, { ownHosts }).map((s) => s.service)).toEqual(['stripe']);
  });
});

describe('extractExternalHttp — the env association', () => {
  it('binds the env var read in the same initializer as the URL fallback', () => {
    const { refs } = extract(`
      const base = process.env.WEATHER_BASE_URL ?? 'https://api.weather.test.example.com';
      const other = process.env.PAYMENTS_BASE || 'https://api.stripe.com';
      const sub = env['SEARCH_ENDPOINT'] || 'https://search.algolia.net';
    `);

    expect(refs.map((r) => [r.host, r.envVar])).toEqual([
      ['api.stripe.com', 'PAYMENTS_BASE'],
      ['search.algolia.net', 'SEARCH_ENDPOINT'],
    ]);
  });

  it('binds a DEFAULTS-map key to its own URL — and never to a sibling entry', () => {
    const { refs } = extract(SPECED_API_CONFIG);

    expect(refs.map((r) => [r.envVar, r.url])).toEqual([
      ['GEOCODING_BASE_URL', 'https://geocoding-api.open-meteo.com'],
      ['FORECAST_BASE_URL', 'https://api.open-meteo.com'],
    ]);
  });

  it('does not read a defaults table as configuration in a file that never touches env', () => {
    const { refs } = extract(`
      const LINKS = { DOCS_BASE_URL: 'https://docs.acme.io/guide' };
    `);

    expect(refs.map((r) => [r.host, r.envVar])).toEqual([['docs.acme.io', undefined]]);
  });

  it('never binds a MODE variable to a URL it merely sits next to', () => {
    const { refs } = extract(`
      const base = process.env.NODE_ENV === 'production' ? 'https://api.acme.io' : 'https://staging.acme.io';
    `);

    expect(refs.every((r) => r.envVar === undefined)).toBe(true);
  });

  it('collects URL-ish env reads with no literal as the lower-confidence tier', () => {
    const { refs, urlEnvReads } = extract(`
      const base = process.env.ALGOLIA_BASE_URL;
      const key = process.env.ALGOLIA_API_KEY;
      const timeout = process.env.TIMEOUT_MS;
    `);

    expect(refs).toEqual([]);
    // A key and a timeout are not base URLs.
    expect(urlEnvReads).toEqual(['ALGOLIA_BASE_URL']);
  });
});

describe('domain grouping', () => {
  it('groups subdomains under the registrable domain and names it without the TLD', () => {
    expect(registrableDomain('geocoding-api.open-meteo.com')).toBe('open-meteo.com');
    expect(registrableDomain('api.open-meteo.com')).toBe('open-meteo.com');
    expect(registrableDomain('open-meteo.com')).toBe('open-meteo.com');
    expect(serviceNameFromDomain('open-meteo.com')).toBe('open-meteo');
  });

  it('keeps three labels for a multi-part public suffix', () => {
    expect(registrableDomain('api.sandbox.acme.co.uk')).toBe('acme.co.uk');
    expect(serviceNameFromDomain('acme.co.uk')).toBe('acme');
    expect(serviceNameFromDomain('acme.com.au')).toBe('acme');
  });
});

describe('detectExternalServices — the HTTP source', () => {
  it('ACCEPTANCE (speced-api): one service, both override vars, each with its default URL', () => {
    const files = [
      analyzed('/repo/src/config.ts', SPECED_API_CONFIG),
      analyzed(
        '/repo/src/upstream/geocoding.ts',
        `
          export async function geocode(name: string, baseUrl: string) {
            const url = new URL('/v1/search', baseUrl);
            return fetch(url.toString());
          }
        `,
      ),
    ];

    expect(detectExternalServices(files)).toEqual([
      {
        service: 'open-meteo',
        source: 'http',
        evidence: [
          { filePath: '/repo/src/config.ts', url: 'https://geocoding-api.open-meteo.com' },
          { filePath: '/repo/src/config.ts', url: 'https://api.open-meteo.com' },
        ],
        baseUrlEnv: 'GEOCODING_BASE_URL',
        baseUrlEnvs: [
          {
            envVar: 'GEOCODING_BASE_URL',
            defaultUrl: 'https://geocoding-api.open-meteo.com',
            confidence: 'literal-fallback',
          },
          {
            envVar: 'FORECAST_BASE_URL',
            defaultUrl: 'https://api.open-meteo.com',
            confidence: 'literal-fallback',
          },
        ],
      },
    ]);
  });

  it('attaches a name-matching env var as the lower-confidence tier', () => {
    const files = [
      analyzed(
        '/repo/src/search.ts',
        `
          const host = 'https://api.algolia.net/1/indexes';
          const override = process.env.ALGOLIA_BASE_URL;
        `,
      ),
    ];

    expect(detectExternalServices(files)[0].baseUrlEnvs).toEqual([
      { envVar: 'ALGOLIA_BASE_URL', confidence: 'name-heuristic' },
    ]);
  });

  it('is order-stable across file discovery order', () => {
    const a = analyzed('/repo/a.ts', `const x = 'https://api.open-meteo.com/v1/forecast';`);
    const b = analyzed('/repo/b.ts', `const y = 'https://api.stripe.com/v1';`);

    expect(detectExternalServices([a, b])).toEqual(detectExternalServices([b, a]));
    expect(detectExternalServices([a, b]).map((s) => s.service)).toEqual(['open-meteo', 'stripe']);
  });
});

describe('detectExternalServices — merge and dedupe', () => {
  it('an SDK hit wins the identity; the HTTP hit still contributes its env vars', () => {
    const files = [
      analyzed(
        '/repo/src/pay.ts',
        `const base = process.env.STRIPE_BASE_URL ?? 'https://api.stripe.com';`,
        ['stripe'],
      ),
    ];

    const [stripe] = detectExternalServices(files);
    expect(stripe.service).toBe('stripe');
    // The registry identity survives — category and import evidence are SDK facts.
    expect(stripe.category).toBe('payment');
    expect(stripe.source).toBe('sdk');
    expect(stripe.evidence).toEqual([
      { filePath: '/repo/src/pay.ts', importSource: 'stripe' },
      { filePath: '/repo/src/pay.ts', url: 'https://api.stripe.com' },
    ]);
    // …and the structural binding beats the name heuristic for `baseUrlEnv`.
    expect(stripe.baseUrlEnvs).toEqual([
      { envVar: 'STRIPE_BASE_URL', defaultUrl: 'https://api.stripe.com', confidence: 'literal-fallback' },
    ]);
    expect(stripe.baseUrlEnv).toBe('STRIPE_BASE_URL');
  });

  it('leaves an SDK-only service exactly as the import registry reported it, plus its source', () => {
    const files = [analyzed('/repo/src/mail.ts', `export const noop = 1;`, ['@sendgrid/mail'])];

    expect(detectExternalServices(files)).toEqual([
      {
        service: 'sendgrid',
        category: 'messaging',
        source: 'sdk',
        evidence: [{ filePath: '/repo/src/mail.ts', importSource: '@sendgrid/mail' }],
      },
    ]);
  });
});
