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
import type { CallExpression, FileAnalysis, SupportedLanguage } from '../../packages/shared/src/types/analysis';
import { detectExternalServices, usesRawHttpClient } from '../../packages/analyzer/src/external-services';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractCalls } from '../../packages/analyzer/src/extractors/calls';

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

/** A FileAnalysis carrying the calls a REAL parse of `code` produced. */
function sourceFile(
  filePath: string,
  code: string,
  language: SupportedLanguage = 'typescript',
): FileAnalysis {
  return {
    ...file(filePath, []),
    language,
    calls: extractCalls(parseCode(code, language), filePath, language, new Map(), code),
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

/**
 * THE AI SDK FAMILY. The registry was written when a vendor meant one package
 * (`openai`, `@anthropic-ai/sdk`), so a repo built on the Vercel AI SDK — which is
 * how modern apps, this one included, reach every vendor — detected NO LLM provider
 * at all, and its LLM-dependent flows blocked on a noun nobody can go and provide.
 */
describe('detectExternalServices — the AI SDK family', () => {
  it('names the VENDOR behind each provider package, and nothing for the agnostic core', () => {
    // `packages/llm-api`, reduced to its imports.
    const analyses = [
      file('/repo/packages/llm-api/src/model.ts', [
        'ai',
        '@ai-sdk/anthropic',
        '@ai-sdk/openai',
        '@ai-sdk/openai-compatible',
        '@ai-sdk/amazon-bedrock',
      ]),
    ];

    // `ai` is transport, exactly like axios — it names no account to provide.
    expect(detectExternalServices(analyses).map((s) => [s.service, s.category])).toEqual([
      ['anthropic', 'ai'],
      ['aws-bedrock', 'ai'],
      ['openai', 'ai'],
    ]);
  });

  it('keeps up with the vendors whose SDK names moved on', () => {
    const analyses = [
      file('/repo/a.ts', ['@anthropic-ai/claude-agent-sdk']),
      file('/repo/b.py', ['google.genai']),
      file('/repo/c.ts', ['@mistralai/mistralai']),
      file('/repo/d.ts', ['groq-sdk']),
      file('/repo/e.ts', ['@openrouter/ai-sdk-provider']),
      file('/repo/f.ts', ['@google/generative-ai']),
    ];

    expect(detectExternalServices(analyses).map((s) => s.service)).toEqual([
      'anthropic',
      'google-ai',
      'groq',
      'mistral',
      'openrouter',
    ]);
  });
});

/**
 * SPAWNED BINARIES — the third source. A program the code EXECUTES is neither an
 * import nor a URL, so `dotnet`, `docker` and the `claude` CLI were invisible to the
 * whole externals model and blocked flows fell back to free-text nouns.
 */
describe('detectExternalServices — the spawned-binary source', () => {
  it('names a program spawned by literal, and says nothing when the name is computed', () => {
    const transport = `
      import { spawn } from 'node:child_process';

      export function runClaude(prompt: string, model: string) {
        const proc = spawn('claude', ['-p', '--model', model, '--output-format', 'stream-json']);
        proc.stdin.write(prompt);
        proc.stdin.end();
        return proc;
      }

      export function runWorker(script: string) {
        // The interpreter running our own code is not a third party — and here it
        // is not even a literal.
        return spawn(process.execPath, [script], { stdio: 'inherit' });
      }
    `;

    expect(detectExternalServices([sourceFile('/repo/src/transport.ts', transport)])).toEqual([
      {
        service: 'claude',
        source: 'binary',
        evidence: [{ filePath: '/repo/src/transport.ts', program: 'claude' }],
      },
    ]);
  });

  it('reads a shell command string down to the program the shell would run', () => {
    const fixtures = `
      import { execSync } from 'node:child_process';

      export function bootFixtures() {
        execSync('docker compose up -d --wait', { stdio: 'inherit' });
        return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      }
    `;

    expect(detectExternalServices([sourceFile('/repo/tests/boot.ts', fixtures)]).map((s) => s.service)).toEqual([
      'docker',
    ]);
  });

  it('reads Python and C# spawns through the same registry', () => {
    const worker = `
import subprocess

def transcode(source, target):
    subprocess.run(["ffmpeg", "-i", source, target], check=True)

def installed_packages():
    return subprocess.check_output(["python3", "-m", "pip", "list"])
`;
    const launcher = `
public static class RoslynHost
{
    public static Process Launch(string dll)
    {
        return Process.Start("dotnet", dll);
    }
}
`;

    const detected = detectExternalServices([
      sourceFile('/repo/worker/media.py', worker, 'python'),
      sourceFile('/repo/src/RoslynHost.cs', launcher, 'csharp'),
    ]);

    expect(detected.map((s) => [s.service, s.source])).toEqual([
      ['dotnet', 'binary'],
      ['ffmpeg', 'binary'],
    ]);
  });

  it('drops the programs any machine that can build the repo already has', () => {
    const scripts = `
      import { spawn, execFile } from 'node:child_process';

      export function build() {
        return spawn('pnpm', ['build'], { stdio: 'inherit' });
      }

      export function serve(entry: string) {
        return spawn('node', [entry]);
      }

      export function dirty(cb: (out: string) => void) {
        execFile('git', ['status', '--porcelain'], (_e, out) => cb(out));
      }

      export function release() {
        // A repo-local script is our own code, and a computed path is no name at all.
        spawn('./scripts/release.sh', []);
        spawn(\`\${binDir}/postinstall\`, []);
      }
    `;

    expect(detectExternalServices([sourceFile('/repo/scripts/tasks.ts', scripts)])).toEqual([]);
  });

  it('never reads a regex match as a spawn', () => {
    const version = `
      const SEMVER = /(\\d+\\.\\d+\\.\\d+)/;

      export function parseVersionLine() {
        return SEMVER.exec('docker 27.0.3')?.[1];
      }
    `;

    expect(detectExternalServices([sourceFile('/repo/src/version.ts', version)])).toEqual([]);
  });
});
