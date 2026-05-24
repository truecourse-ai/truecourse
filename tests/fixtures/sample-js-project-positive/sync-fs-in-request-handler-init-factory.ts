// Factory-style functions named `create*` / `init*` are invoked once at
// server bootstrap, not on per-request hot paths. Sync filesystem calls here
// block the boot sequence (which is fine) — not the request loop.

import fs from 'node:fs';

interface SignerConfig {
  cert: Buffer;
  key: Buffer;
}

export const createCryptoSigner = async (
  certPath: string,
  keyPath: string,
): Promise<SignerConfig> => {
  if (!fs.existsSync(certPath)) {
    throw new Error('cert missing');
  }
  const cert = fs.readFileSync(certPath);
  const key = fs.readFileSync(keyPath);
  await registerWithRemote(cert);
  return { cert, key };
};

export async function initRemoteSigner(configPath: string): Promise<void> {
  const config = fs.readFileSync(configPath);
  await registerWithRemote(config);
}

async function registerWithRemote(_config: Buffer): Promise<void> {
  await Promise.resolve();
}
