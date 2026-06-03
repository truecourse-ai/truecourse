import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  maskKey,
} from '../../ee/packages/server/src/llm/crypto';

const SECRET = 'master-secret-at-least-32-chars-long!!';

describe('llm provider key crypto', () => {
  it('round-trips a secret and stores ciphertext, not plaintext', () => {
    const enc = encryptSecret('sk-ant-12345', SECRET);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('sk-ant-12345');
    expect(decryptSecret(enc, SECRET)).toBe('sk-ant-12345');
  });

  it('uses a fresh iv each time (ciphertext differs, plaintext recovers)', () => {
    const a = encryptSecret('same-key', SECRET);
    const b = encryptSecret('same-key', SECRET);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, SECRET)).toBe('same-key');
    expect(decryptSecret(b, SECRET)).toBe('same-key');
  });

  it('fails to decrypt with the wrong master secret', () => {
    const enc = encryptSecret('topsecret', SECRET);
    expect(() => decryptSecret(enc, 'a-different-master-secret-32-chars!!')).toThrow();
  });

  it('detects tampering via the GCM auth tag', () => {
    const enc = encryptSecret('topsecret', SECRET);
    const parts = enc.split(':');
    const data = Buffer.from(parts[3], 'base64');
    data[0] ^= 0xff; // flip a ciphertext byte
    parts[3] = data.toString('base64');
    expect(() => decryptSecret(parts.join(':'), SECRET)).toThrow();
  });

  it('rejects a malformed blob', () => {
    expect(() => decryptSecret('not-a-blob', SECRET)).toThrow();
  });

  it('masks to the last 4 characters only', () => {
    expect(maskKey('sk-ant-abcd1234')).toBe('••••1234');
    expect(maskKey('xy')).toBe('••••');
  });
});
