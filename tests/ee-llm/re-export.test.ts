/**
 * `@truecourse/ee-llm` is a thin re-export of the OSS transport package
 * `@truecourse/llm-api`. EE server/client code imports the transport through
 * this name, so the surface must stay complete.
 */

import { describe, it, expect } from 'vitest';
import * as eeLlm from '../../ee/packages/llm/src/index';
import * as llmApi from '../../packages/llm-api/src/index';

describe('@truecourse/ee-llm re-export', () => {
  it('exposes the transport factory under both names', () => {
    expect(typeof eeLlm.createApiTransport).toBe('function');
    expect(eeLlm.createAiSdkTransport).toBe(eeLlm.createApiTransport);
  });

  it('re-exports every runtime export of @truecourse/llm-api', () => {
    const runtimeExports = Object.keys(llmApi).sort();
    expect(runtimeExports.length).toBeGreaterThan(0);
    expect(Object.keys(eeLlm).sort()).toEqual(runtimeExports);
  });

  it('builds a usable transport from a provider config', () => {
    const transport = eeLlm.createAiSdkTransport({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'test',
    });
    expect(typeof transport).toBe('function');
  });
});
