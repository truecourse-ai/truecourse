/**
 * EXTERNAL-SERVICE DETECTION — the per-service identity the layer
 * detector throws away.
 *
 * The regression that motivates the whole module is the EARLY RETURN: `detectLayers`
 * stops at the first external import it sees, because a boolean is all it owes its
 * caller. A repo that talks to stripe AND sendgrid must yield both here, or a
 * blocked-on gap names the wrong third party.
 */

import { describe, it, expect } from 'vitest';
import type { CallExpression, FileAnalysis } from '../../packages/shared/src/types/analysis';
import { detectExternalServices, usesRawHttpClient } from '../../packages/analyzer/src/external-services';

function file(filePath: string, sources: string[], calls: CallExpression[] = []): FileAnalysis {
  return {
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: sources.map((source) => ({
      source,
      specifiers: [{ name: 'default', alias: undefined, isDefault: true, isNamespace: false }],
      isTypeOnly: false,
    })),
    exports: [],
    calls,
    httpCalls: [],
  };
}

function call(callee: string, args: string[]): CallExpression {
  return {
    callee,
    arguments: args,
    location: { filePath: '/repo/x.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 },
  };
}

describe('detectExternalServices', () => {
  it('collects EVERY service in a file — no early return on the first match', () => {
    const analyses = [file('/repo/src/checkout.ts', ['stripe', '@sendgrid/mail', 'axios'])];

    expect(detectExternalServices(analyses).map((s) => s.service)).toEqual(['sendgrid', 'stripe']);
  });

  it('excludes generic HTTP clients from the named list, and reports them separately', () => {
    const analyses = [file('/repo/src/fetcher.ts', ['axios', 'node-fetch', 'requests'])];

    expect(detectExternalServices(analyses)).toEqual([]);
    expect(usesRawHttpClient(analyses)).toBe(true);
    expect(usesRawHttpClient([file('/repo/src/pure.ts', ['./local'])])).toBe(false);
  });

  it('merges the same service across files and keeps each file as evidence', () => {
    const analyses = [
      file('/repo/src/a.ts', ['stripe']),
      file('/repo/src/b.ts', ['stripe/lib/Webhooks']),
      file('/repo/src/c.ts', ['@sendgrid/mail']),
    ];

    const detected = detectExternalServices(analyses);
    expect(detected.map((s) => s.service)).toEqual(['sendgrid', 'stripe']);
    const stripe = detected.find((s) => s.service === 'stripe')!;
    expect(stripe.category).toBe('payment');
    expect(stripe.evidence).toEqual([
      { filePath: '/repo/src/a.ts', importSource: 'stripe' },
      // A deep import into a known SDK is the SAME dependency — matched on its root.
      { filePath: '/repo/src/b.ts', importSource: 'stripe/lib/Webhooks' },
    ]);
  });

  it('categorizes each registry section, and never invents one for a local module', () => {
    const analyses = [
      file('/repo/a.ts', ['@aws-sdk/client-s3']),
      file('/repo/b.ts', ['twilio']),
      file('/repo/c.ts', ['openai']),
      file('/repo/d.ts', ['passport']),
      file('/repo/e.ts', ['kafkajs']),
      file('/repo/f.ts', ['./stripe', '../lib/twilio', 'stripe-helpers']),
    ];

    expect(detectExternalServices(analyses).map((s) => [s.service, s.category])).toEqual([
      ['aws', 'cloud'],
      ['kafka', 'queue'],
      ['openai', 'ai'],
      ['passport', 'auth'],
      ['twilio', 'messaging'],
    ]);
  });

  it('reads a Python dotted module down to its dependency root', () => {
    const analyses = [file('/repo/app/mail.py', ['boto3.session'])];

    expect(detectExternalServices(analyses).map((s) => s.service)).toEqual(['aws']);
  });

  it('surfaces a base-URL env override visible in call text, and nothing when there is none', () => {
    const withEnv = [
      file('/repo/src/pay.ts', ['stripe'], [
        call('Stripe', ['process.env.STRIPE_API_KEY', '{ apiBase: process.env.STRIPE_API_BASE }']),
      ]),
    ];
    expect(detectExternalServices(withEnv)[0].baseUrlEnv).toBe('STRIPE_API_BASE');

    // A key is not a base URL, and another service's URL is not this one's.
    const withoutEnv = [
      file('/repo/src/pay.ts', ['stripe'], [call('Stripe', ['process.env.STRIPE_API_KEY', 'process.env.SENDGRID_HOST'])]),
    ];
    expect(detectExternalServices(withoutEnv)[0].baseUrlEnv).toBeUndefined();
  });

  it('is stable and pure: same input, same order, regardless of file order', () => {
    const a = file('/repo/a.ts', ['twilio']);
    const b = file('/repo/b.ts', ['stripe']);

    expect(detectExternalServices([a, b])).toEqual(detectExternalServices([b, a]));
    expect(detectExternalServices([])).toEqual([]);
  });
});
