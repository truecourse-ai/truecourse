import { describe, it } from 'vitest';
import { extractCodeContracts } from '../../packages/contract-verifier/src/extractor/code-contracts.js';

describe('debug Prefect settings extraction', () => {
  it('extracts constants from PrefectHQ flows.py', async () => {
    const codeDir = '/tmp/prefect-target';
    const result = await extractCodeContracts(codeDir);
    const constants = await result.constants();
    const relevant = constants.filter((c) =>
      c.name.toLowerCase().includes('heartbeat') ||
      c.name.toLowerCase().includes('setup_timeout') ||
      c.name.toLowerCase().includes('tag_concurrency')
    );
    console.log('Relevant constants extracted:');
    for (const c of relevant) {
      console.log(`  name=${c.name}, value=${JSON.stringify(c.value)}, file=${c.source.filePath.split('/').slice(-2).join('/')}`);
    }
    console.log('Total constants extracted:', constants.length);
  });
});
