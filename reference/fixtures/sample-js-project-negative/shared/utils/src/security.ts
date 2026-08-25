// VIOLATION: architecture/deterministic/god-module
/**
 * Security utilities and middleware helpers.
 */

import fs from 'fs';
import path from 'path';

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function sanitizeInput(input: string) {
  return input.replace(/[<>&'"]/g, '');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function unsafeInnerHtml(userInput: string) {
  const element = document.getElementById('output')!;
  // VIOLATION: security/deterministic/disabled-auto-escaping
  element.innerHTML = userInput;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function runUserCommand(filename: string) {
  const { execSync } = require('child_process');
  // VIOLATION: security/deterministic/os-command-injection
  return execSync(`cat ${filename}`);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function cleanupLogs() {
  const { execSync } = require('child_process');
  // VIOLATION: security/deterministic/wildcard-in-os-command
  execSync('rm -rf /tmp/*.log');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function readUserFile(req: any) {
  // VIOLATION: security/deterministic/user-input-in-path
  const data = fs.readFileSync(req.params.filePath, 'utf8');
  return data;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function redirectToUrl(req: any, res: any) {
  // VIOLATION: security/deterministic/user-input-in-redirect
  res.redirect(req.query.returnUrl);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function handleUpload() {
  const multer = (opts: any) => opts;
  // VIOLATION: security/deterministic/unrestricted-file-upload
  return multer({ dest: 'uploads/' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function setPermissions() {
  // VIOLATION: security/deterministic/file-permissions-world-accessible
  fs.chmodSync('/tmp/data.txt', 0o777);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function writeToTemp() {
  // VIOLATION: security/deterministic/publicly-writable-directory
  fs.writeFileSync('/tmp/cache/data.json', '{}');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function buildPathFromRequest(req: any) {
  // VIOLATION: security/deterministic/path-command-injection
  return path.join('/uploads', req.params.filename);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function createUserFromRequest(req: any) {
  const User = { create: (data: any) => data };
  // VIOLATION: security/deterministic/mass-assignment
  return User.create(req.body);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function performSqlQuery(userId: string) {
  const db = { query: (q: string) => q };
  // VIOLATION: security/deterministic/sql-injection
  return db.query(`SELECT * FROM users WHERE id = '${userId}'`);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function runArbitraryCode(code: string) {
  // VIOLATION: security/deterministic/eval-usage
  return eval(code);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function hardcodedAuth() {
  const db = { authenticate: (u: string, p: string) => true };
  // VIOLATION: security/deterministic/hardcoded-password-function-arg
  return db.authenticate('admin', 'SuperSecret123!');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function logSensitiveData(password: string) {
  // VIOLATION: security/deterministic/confidential-info-logging
  console.log('User password:', password);
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function getUserIdFromBody(req: any) {
  // VIOLATION: security/deterministic/user-id-from-request-body
  const userId = req.body.userId;
  return userId;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function longTermKeys() {
  // VIOLATION: security/deterministic/long-term-aws-keys-in-code
  const accessKeyId = 'AKIAIOSFODNN7EXAMPLE';
  return { accessKeyId };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function sensitiveUrl() {
  // VIOLATION: security/deterministic/sensitive-data-in-url
  return fetch('https://api.example.com/login?password=secret123');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function fetchLegacyApi() {
  // VIOLATION: security/deterministic/clear-text-protocol
  return fetch('http://api.legacy-system.com/v1/data');
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function loadWalletFromBackup() {
  // VIOLATION: security/deterministic/hardcoded-blockchain-mnemonic
  const mnemonic = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
  return mnemonic;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function getInternalServiceUrl() {
  // VIOLATION: security/deterministic/hardcoded-ip
  const dbHost = '10.0.3.47';
  return `https://${dbHost}:5432/mydb`;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function connectToPaymentGateway() {
  // VIOLATION: security/deterministic/hardcoded-secret
  const apiSecret = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';
  return { apiSecret };
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function setSessionCookie(res: any, token: string) {
  // VIOLATION: security/deterministic/cookie-without-httponly
  res.cookie('session', token, { secure: true, sameSite: 'strict' });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function queryLdapDirectory() {
  // VIOLATION: security/deterministic/ldap-unauthenticated
  const ldapUrl = 'ldap://directory.corp.example.com/dc=example,dc=com';
  return ldapUrl;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function registerUser(req: any) {
  const User = { create: (data: any) => data };
  // VIOLATION: security/deterministic/password-stored-plaintext
  return User.create({ email: req.body.email, password: req.body.password });
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function hashUserPassword(password: string) {
  const crypto = require('crypto');
  // VIOLATION: security/deterministic/unpredictable-salt-missing
  return crypto.createHash('sha256').update(password).digest('hex');
}
