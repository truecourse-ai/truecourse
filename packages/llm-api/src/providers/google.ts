/**
 * Google, the Gemini API. Every tool is sent strict (the SDK then asks for
 * mode VALIDATED) with the schema as authored, optionals optional.
 *
 * Gemini caches prefixes implicitly and has no parallel-call switch. Gemini 3
 * models take a session's reasoning level as their thinking level; older
 * models keep their native default because they do not accept thinkingLevel.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { defineProvider, type ProviderOptionsBag } from './define.js';

export const google = defineProvider({
  kind: 'google',
  capabilities: {
    strictTools: true,
    // Gemini compiles a strict tool schema into a constrained decoder, and that
    // compilation has an undocumented size limit. Past it, a request in mode
    // VALIDATED (what the SDK sends when any tool is strict) fails with a generic
    // 400 "Request contains an invalid argument"; the same request in mode AUTO
    // is accepted. No keyword causes it: stripping bounds, patterns, formats,
    // descriptions, `additionalProperties`, `const` or `$schema`, or inlining
    // the `$ref`s, changes nothing. It is size alone. With local refs inlined,
    // the two schemas refused on gemini-3.8-flash are the `check_draft` input
    // (217,550 bytes, 1,733 `anyOf` branches) and the flow-worker outcome
    // (87,916 bytes, 688 branches); the largest accepted is the
    // `observe_screen` input (62,353 bytes, 507 branches), and the next largest
    // is about 6 KB. Their owners declare them large, and a request carrying
    // one is sent with no tool strict, so it runs in AUTO. The mode is per
    // request, not per tool: every call of such a session goes unenforced by
    // Gemini. The shell's Zod validation still checks every call and outcome,
    // so what the session loses is a re-ask on a malformed call, not
    // correctness.
    enforcesLargeSchemas: false,
  },
  buildModel: (cfg, modelId) =>
    createGoogleGenerativeAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, headers: cfg.headers })(modelId),
  callOptions: () => ({}),
  reasoning: (modelId, level): ProviderOptionsBag =>
    /^gemini-3[.-]/.test(modelId) ? { google: { thinkingConfig: { thinkingLevel: level } } } : {},
});
