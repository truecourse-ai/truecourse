
// Buffer.from wrapping a function result
declare function symmetricDecrypt(opts: { key: string; data: string }): string;
declare const encryptionKey: string;
declare const encryptedData: string;

function decryptToBuffer(key: string, data: string): Buffer {
  const decrypted = symmetricDecrypt({ key, data });
  return Buffer.from(decrypted);
}

const secretBuffer = Buffer.from(symmetricDecrypt({ key: encryptionKey, data: encryptedData }));



// new Uint8Array(Buffer.from(data, 'base64'))
declare function getBase64EncodedContent(): string;
import fs from 'fs';

function writeBase64ContentToFile(filePath: string, base64Data: string): void {
  const contents = new Uint8Array(Buffer.from(base64Data, 'base64'));
  fs.writeFileSync(filePath, contents);
}



// Buffer.from wrapping Uint8Array conversion from base64url
declare function toBuffer(base64urlStr: string): Uint8Array;
declare interface PasskeyData { credentialId: string; publicKey: string; }

function buildPasskeyBuffers(data: PasskeyData): { credentialId: Buffer; publicKey: Buffer } {
  return {
    credentialId: Buffer.from(toBuffer(data.credentialId)),
    publicKey: Buffer.from(toBuffer(data.publicKey)),
  };
}



// Generate 20-byte cryptographic token for account link confirmation
declare const crypto: { randomBytes(size: number): Buffer };

function generateAccountLinkToken(): string {
  return crypto.randomBytes(20).toString('hex');
}


// magic-string FP: 'base64' and 'utf-8' are Node.js Buffer encoding constants, not magic strings
declare function getEnvCertContents(): string | undefined;

function decodeCertificateContents(encodedContents: string): string {
  return Buffer.from(encodedContents, 'base64').toString('utf-8');
}

export function loadCertificatePemFromEnv(): string | null {
  const encodedContents = getEnvCertContents();
  if (!encodedContents) {
    return null;
  }
  return decodeCertificateContents(encodedContents);
}

