import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecExtractionManifest } from '../../packages/analyzer/src/spec-discovery';
import {
  buildRequirementExtractionCacheKey,
  extractRequirementsFromManifest,
  redactSpecText,
  type ProseRequirementExtractionInput,
  type ProseRequirementExtractionProvider,
} from '../../packages/core/src/services/spec-requirement-extraction.service';

const tempDirs: string[] = [];

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'truecourse-req-extract-'));
  tempDirs.push(dir);
  return dir;
}

function writeFixture(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function requirementCandidate(evidenceText = 'Users must sign in before checking out.'): unknown {
  return {
    requirements: [
      {
        kind: 'auth',
        modality: 'must',
        subject: 'users',
        action: 'sign in',
        object: 'checkout',
        constraints: [{ type: 'beforeAction', value: 'checkout' }],
        evidenceText,
        confidence: 0.91,
      },
    ],
  };
}

class MockRequirementProvider implements ProseRequirementExtractionProvider {
  model = 'mock-model-v1';
  calls: ProseRequirementExtractionInput[] = [];

  constructor(private readonly output: unknown = requirementCandidate()) {}

  async extractProseRequirements(input: ProseRequirementExtractionInput): Promise<unknown> {
    this.calls.push(input);
    return this.output;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('LLM requirement extraction', () => {
  it('turns prose chunks into validated stable requirements', async () => {
    const root = tempProject();
    writeFixture(root, 'docs/checkout.md', '# Checkout\n\nUsers must sign in before checking out.\n');
    const manifest = createSpecExtractionManifest(root);
    const provider = new MockRequirementProvider();

    const first = await extractRequirementsFromManifest(root, manifest, provider);
    const second = await extractRequirementsFromManifest(root, manifest, new MockRequirementProvider());

    expect(first.errors).toEqual([]);
    expect(first.requirements).toHaveLength(1);
    expect(first.requirements[0]).toMatchObject({
      id: expect.stringMatching(/^req_[a-f0-9]{12}$/),
      sourceFile: 'docs/checkout.md',
      sourceRange: { startLine: 1, endLine: 3 },
      kind: 'auth',
      modality: 'must',
      subject: 'users',
      action: 'sign in',
      object: 'checkout',
      extractor: {
        name: 'spec-llm-requirement-extractor',
      },
    });
    expect(second.requirements).toEqual(first.requirements);
  });

  it('reuses cached extractions without calling the provider', async () => {
    const root = tempProject();
    writeFixture(root, 'docs/checkout.md', '# Checkout\n\nUsers must sign in before checking out.\n');
    const manifest = createSpecExtractionManifest(root);
    const firstProvider = new MockRequirementProvider();

    const first = await extractRequirementsFromManifest(root, manifest, firstProvider);
    const secondProvider = new MockRequirementProvider({ requirements: [] });
    const second = await extractRequirementsFromManifest(root, manifest, secondProvider);

    expect(firstProvider.calls).toHaveLength(1);
    expect(secondProvider.calls).toHaveLength(0);
    expect(first.llmCallCount).toBe(1);
    expect(second.llmCallCount).toBe(0);
    expect(second.cacheHits).toBe(1);
    expect(second.cacheMisses).toBe(0);
    expect(second.requirements).toEqual(first.requirements);
  });

  it('changes cache keys when versioned cache inputs change', () => {
    const base = {
      specFileHash: 'spec-a',
      chunkHash: 'chunk-a',
      model: 'model-a',
    };
    const key = buildRequirementExtractionCacheKey(base);

    expect(buildRequirementExtractionCacheKey({ ...base, chunkHash: 'chunk-b' })).not.toBe(key);
    expect(buildRequirementExtractionCacheKey({ ...base, model: 'model-b' })).not.toBe(key);
    expect(buildRequirementExtractionCacheKey({ ...base, schemaVersion: 'spec-requirement.v2' })).not.toBe(key);
    expect(buildRequirementExtractionCacheKey({ ...base, promptVersion: 'spec-compliance-prompt.v5' })).not.toBe(key);
  });

  it('redacts secrets before sending chunk text or prompt to the provider', async () => {
    const root = tempProject();
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    writeFixture(root, 'docs/auth.md', `# Auth\n\nUsers must rotate token=${secret} before launch.\n`);
    const manifest = createSpecExtractionManifest(root);
    const provider = new MockRequirementProvider(requirementCandidate('Users must rotate tokens before launch.'));

    await extractRequirementsFromManifest(root, manifest, provider);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].text).toContain('[REDACTED_SECRET]');
    expect(provider.calls[0].prompt).toContain('[REDACTED_SECRET]');
    expect(provider.calls[0].text).not.toContain(secret);
    expect(provider.calls[0].prompt).not.toContain(secret);
    expect(redactSpecText(`api_key="${secret}"`)).toBe('api_key="[REDACTED_SECRET]"');
  });

  it('rejects malformed model output safely', async () => {
    const root = tempProject();
    writeFixture(root, 'docs/checkout.md', '# Checkout\n\nUsers must sign in before checking out.\n');
    const manifest = createSpecExtractionManifest(root);
    const provider = new MockRequirementProvider({
      requirements: [
        {
          kind: 'auth',
          modality: 'required',
          subject: 'users',
          action: 'sign in',
          constraints: [],
          evidenceText: 'Users must sign in before checking out.',
          confidence: 1.5,
        },
      ],
    });

    const result = await extractRequirementsFromManifest(root, manifest, provider);

    expect(result.requirements).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('Invalid');
  });

  it('skips prose chunks deterministically when LLM extraction is disabled', async () => {
    const root = tempProject();
    writeFixture(root, 'docs/checkout.md', '# Checkout\n\nUsers must sign in before checking out.\n');
    const manifest = createSpecExtractionManifest(root);
    const provider = new MockRequirementProvider();

    const result = await extractRequirementsFromManifest(root, manifest, provider, { useLlm: false });

    expect(provider.calls).toHaveLength(0);
    expect(result.requirements).toEqual([]);
    expect(result.errors[0].message).toContain('LLM extraction is disabled');
    expect(result.skippedChunks).toBe(1);
  });
});
