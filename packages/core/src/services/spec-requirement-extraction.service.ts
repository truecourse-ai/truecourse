import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  RequirementSchema,
  SPEC_COMPLIANCE_PROMPT_VERSION,
  SPEC_COMPLIANCE_REQUIREMENT_SCHEMA_VERSION,
  canonicalJson,
  createRequirementId,
  type Requirement,
  type SourceRange,
  type SpecChunk,
  type SpecExtractionManifest,
} from '@truecourse/shared';
import {
  readRequirementExtractionCache,
  writeRequirementExtractionCache,
} from '../lib/analysis-store.js';

export const SPEC_REQUIREMENT_LLM_EXTRACTOR = {
  name: 'spec-llm-requirement-extractor',
  version: SPEC_COMPLIANCE_PROMPT_VERSION,
} as const;

export interface ProseRequirementExtractionInput {
  prompt: string;
  sourceFile: string;
  sourceRange: SourceRange;
  headingPath: string[];
  text: string;
  schemaVersion: string;
  promptVersion: string;
  temperature: 0;
}

export interface ProseRequirementExtractionProvider {
  model: string;
  extractProseRequirements(input: ProseRequirementExtractionInput): Promise<unknown>;
}

export interface RequirementExtractionCacheKeyInput {
  specFileHash: string;
  chunkHash: string;
  schemaVersion?: string;
  promptVersion?: string;
  model: string;
}

export interface RequirementExtractionError {
  sourceFile: string;
  chunkId: string;
  message: string;
}

export interface ExtractRequirementsOptions {
  useLlm?: boolean;
  schemaVersion?: string;
  promptVersion?: string;
}

export interface RequirementExtractionResult {
  requirements: Requirement[];
  errors: RequirementExtractionError[];
  cacheHits: number;
  cacheMisses: number;
  skippedChunks: number;
  llmCallCount: number;
}

interface RequirementCacheEntry {
  schemaVersion: string;
  promptVersion: string;
  model: string;
  specFileHash: string;
  chunkHash: string;
  requirements: Requirement[];
}

const RequirementCandidateSchema = RequirementSchema
  .omit({
    id: true,
    sourceFile: true,
    sourceRange: true,
    extractor: true,
  })
  .extend({
    sourceRange: RequirementSchema.shape.sourceRange.optional(),
  })
  .strict();

export const ProseRequirementExtractionOutputSchema = z.union([
  z.object({ requirements: z.array(RequirementCandidateSchema) }).strict(),
  z.array(RequirementCandidateSchema),
]);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildProseRequirementExtractionPrompt(input: Omit<ProseRequirementExtractionInput, 'prompt'>): string {
  return [
    `Prompt version: ${input.promptVersion}`,
    `Requirement schema version: ${input.schemaVersion}`,
    '',
    'Convert only the provided prose spec chunk into atomic requirements.',
    'Do not extract code facts. Do not inspect implementation code. Do not decide compliance.',
    'Return strict JSON with a top-level `requirements` array. Each item must contain only fields compatible with RequirementSchema except id, sourceFile, sourceRange, and extractor, which are assigned by TrueCourse.',
    'Use kind values: api, ui, ux, auth, data, infra, config, workflow, test, quality, unknown.',
    'Use modality values: must, should, may, must_not.',
    'If the chunk contains no actionable requirement, return an empty array.',
    '',
    `Source file: ${input.sourceFile}`,
    `Source range: ${input.sourceRange.startLine}-${input.sourceRange.endLine}`,
    `Heading path: ${input.headingPath.join(' > ') || '(none)'}`,
    '',
    'Spec chunk:',
    input.text,
  ].join('\n');
}

export function buildRequirementExtractionCacheKey(input: RequirementExtractionCacheKeyInput): string {
  const hash = sha256(canonicalJson({
    specFileHash: input.specFileHash,
    chunkHash: input.chunkHash,
    schemaVersion: input.schemaVersion ?? SPEC_COMPLIANCE_REQUIREMENT_SCHEMA_VERSION,
    promptVersion: input.promptVersion ?? SPEC_COMPLIANCE_PROMPT_VERSION,
    model: input.model,
  })).slice(0, 32);

  return `spec_req_llm_${hash}`;
}

export function redactSpecText(text: string): string {
  return text
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
    .replace(/\bASIA[0-9A-Z]{16}\b/g, '[REDACTED_SECRET]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g, '[REDACTED_SECRET]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_SECRET]')
    .replace(/\b(?:xox[baprs]-)[A-Za-z0-9-]{20,}\b/g, '[REDACTED_SECRET]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_SECRET]')
    .replace(
      /\b(password|passwd|secret|api[_-]?key|token|client[_-]?secret)\b(\s*[:=]\s*)(["']?)[^\s"',`]+(\3)/gi,
      '$1$2$3[REDACTED_SECRET]$4',
    );
}

function normalizeProviderOutput(output: unknown): z.infer<typeof RequirementCandidateSchema>[] {
  const parsed = ProseRequirementExtractionOutputSchema.parse(output);
  return Array.isArray(parsed) ? parsed : parsed.requirements;
}

function candidateToRequirement(chunk: SpecChunk, candidate: z.infer<typeof RequirementCandidateSchema>): Requirement {
  const sourceRange = candidate.sourceRange ?? chunk.sourceRange;
  const evidenceText = candidate.evidenceText.trim();
  const requirement: Requirement = {
    id: createRequirementId({
      sourceFile: chunk.sourceFile,
      sourceRange,
      evidenceText,
      extractorVersion: SPEC_REQUIREMENT_LLM_EXTRACTOR.version,
    }),
    sourceFile: chunk.sourceFile,
    sourceRange,
    kind: candidate.kind,
    modality: candidate.modality,
    subject: candidate.subject.trim(),
    action: candidate.action.trim(),
    object: candidate.object?.trim(),
    constraints: candidate.constraints,
    acceptanceCriteria: candidate.acceptanceCriteria,
    evidenceText,
    confidence: candidate.confidence,
    extractor: SPEC_REQUIREMENT_LLM_EXTRACTOR,
  };

  return RequirementSchema.parse(requirement);
}

function readValidCache(repoPath: string, cacheKey: string): RequirementCacheEntry | null {
  const cached = readRequirementExtractionCache<RequirementCacheEntry>(repoPath, cacheKey);
  if (!cached) return null;

  const validRequirements = z.array(RequirementSchema).safeParse(cached.requirements);
  if (!validRequirements.success) return null;
  return { ...cached, requirements: validRequirements.data };
}

export async function extractRequirementsFromManifest(
  repoPath: string,
  manifest: SpecExtractionManifest,
  provider: ProseRequirementExtractionProvider,
  options: ExtractRequirementsOptions = {},
): Promise<RequirementExtractionResult> {
  const useLlm = options.useLlm ?? true;
  const schemaVersion = options.schemaVersion ?? SPEC_COMPLIANCE_REQUIREMENT_SCHEMA_VERSION;
  const promptVersion = options.promptVersion ?? SPEC_COMPLIANCE_PROMPT_VERSION;
  const result: RequirementExtractionResult = {
    requirements: manifest.files.flatMap((file) => file.requirements),
    errors: [],
    cacheHits: 0,
    cacheMisses: 0,
    skippedChunks: 0,
    llmCallCount: 0,
  };

  for (const file of manifest.files) {
    if (file.status !== 'parsed') continue;

    for (const chunk of file.chunks) {
      if (!useLlm) {
        result.skippedChunks++;
        result.errors.push({
          sourceFile: chunk.sourceFile,
          chunkId: chunk.id,
          message: 'Prose requirement extraction skipped because LLM extraction is disabled.',
        });
        continue;
      }

      const cacheKey = buildRequirementExtractionCacheKey({
        specFileHash: file.hash,
        chunkHash: chunk.hash,
        schemaVersion,
        promptVersion,
        model: provider.model,
      });
      const cached = readValidCache(repoPath, cacheKey);
      if (cached) {
        result.requirements.push(...cached.requirements);
        result.cacheHits++;
        continue;
      }

      result.cacheMisses++;
      result.llmCallCount++;
      try {
        const redactedText = redactSpecText(chunk.text);
        const output = await provider.extractProseRequirements({
          prompt: buildProseRequirementExtractionPrompt({
            sourceFile: chunk.sourceFile,
            sourceRange: chunk.sourceRange,
            headingPath: chunk.headingPath,
            text: redactedText,
            schemaVersion,
            promptVersion,
            temperature: 0,
          }),
          sourceFile: chunk.sourceFile,
          sourceRange: chunk.sourceRange,
          headingPath: chunk.headingPath,
          text: redactedText,
          schemaVersion,
          promptVersion,
          temperature: 0,
        });
        const requirements = normalizeProviderOutput(output).map((candidate) => candidateToRequirement(chunk, candidate));

        const cacheEntry: RequirementCacheEntry = {
          schemaVersion,
          promptVersion,
          model: provider.model,
          specFileHash: file.hash,
          chunkHash: chunk.hash,
          requirements,
        };
        writeRequirementExtractionCache(repoPath, cacheKey, cacheEntry);
        result.requirements.push(...requirements);
      } catch (error) {
        result.errors.push({
          sourceFile: chunk.sourceFile,
          chunkId: chunk.id,
          message: error instanceof Error ? error.message : 'Malformed requirement extraction output',
        });
      }
    }
  }

  result.requirements.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return result;
}
