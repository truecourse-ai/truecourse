import { describe, it } from 'vitest';
import { verify } from '../../packages/contract-verifier/src/verify.js';

describe('debug Prefect verify', () => {
  it('counts named-constant/no-code-counterpart drifts', async () => {
    const result = await verify({
      contractsDir: '/tmp/prefect-target/.truecourse/contracts',
      codeDir: '/tmp/prefect-target',
    });
    const nc = result.drifts.filter(
      (d) => d.obligationKey.includes('no-code-counterpart') && d.obligationKey.startsWith('constant.')
    );
    console.log(`named-constant/no-code-counterpart count: ${nc.length}`);
    const interesting = nc.filter((d) =>
      d.obligationKey.includes('HEARTBEAT_FREQUENCY') ||
      d.obligationKey.includes('PLUGINS_SETUP') ||
      d.obligationKey.includes('TAG_CONCURRENCY')
    );
    for (const d of interesting) {
      console.log(`  STILL DRIFTING: ${d.obligationKey}`);
    }
    console.log(`Total drifts: ${result.drifts.length}`);
  });
}, 120_000);
