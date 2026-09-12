import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { PREPARATION_VERIFY_ENV, PREPARATION_VERIFY_INPUTS_SOURCE } from '../../packages/guard-runner/src/preparation-contract';

const environment = () => Object.fromEntries(Object.values(PREPARATION_VERIFY_ENV).map(name => [name, '{}']));
const execute = (env: Record<string, string>, suffix = '') =>
  runInNewContext(PREPARATION_VERIFY_INPUTS_SOURCE + '\n' + suffix, { process: { env } });

describe('preparation verifier input example', () => {
  it.each(Object.values(PREPARATION_VERIFY_ENV))('identifies missing input %s before making requests', name => {
    const env = environment();
    delete env[name];
    expect(() => execute(env)).toThrow(`Missing preparation input: ${name}`);
  });

  it.each(['{secret-invalid-json', 'null', '[]', '42'])('rejects invalid maps without exposing their contents (%s)', value => {
    const env = { ...environment(), [PREPARATION_VERIFY_ENV.peerCredentials]: value };
    expect(() => execute(env)).toThrow(PREPARATION_VERIFY_ENV.peerCredentials);
    try { execute(env); } catch (error) { expect(String(error)).not.toContain(value); }
  });

  it.each([undefined, '', '   ', 42])('rejects a missing or unusable peer credential value: %s', value => {
    const env = { ...environment(), [PREPARATION_VERIFY_ENV.peerCredentials]: JSON.stringify({ owner: { value } }) };
    expect(() => execute(env, "requiredPreparationCredential(peerCredentials, 'owner')")).toThrow('Missing preparation credential: owner');
  });

  it('does not accept the old unprefixed aliases as peer inputs', () => {
    const env = { ...environment(), PEER_CREDENTIALS: '{"owner":{"value":"wrong"}}' };
    delete env[PREPARATION_VERIFY_ENV.peerCredentials];
    expect(() => execute(env)).toThrow(`Missing preparation input: ${PREPARATION_VERIFY_ENV.peerCredentials}`);
  });
});
