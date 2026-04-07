/**
 * Security violations related to injection attacks.
 */

import crypto from 'crypto';

// VIOLATION: security/deterministic/sql-injection
export function sqlInjection(userId: string) {
  const db = { query: (q: string) => q };
  return db.query(`SELECT * FROM users WHERE id = '${userId}'`);
}

// VIOLATION: security/deterministic/eval-usage
export function evalUsage(code: string) {
  return eval(code);
}

// VIOLATION: security/deterministic/eval-usage
export function newFunctionUsage(code: string) {
  return new Function(code);
}

// VIOLATION: security/deterministic/os-command-injection
export function osCommandInjection(filename: string) {
  const { execSync } = require('child_process');
  return execSync(`cat ${filename}`);
}

// VIOLATION: security/deterministic/weak-hashing
export function weakHashing(data: string) {
  return crypto.createHash('md5').update(data).digest('hex');
}

// VIOLATION: security/deterministic/weak-hashing
export function weakHashingSha1(data: string) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

// VIOLATION: security/deterministic/insecure-random
export function insecureRandom() {
  const token = Math.random().toString(36);
  return token;
}

// VIOLATION: security/deterministic/hardcoded-password-function-arg
export function hardcodedPassword() {
  const db = { authenticate: (u: string, p: string) => true };
  return db.authenticate('admin', 'SuperSecret123!');
}

// VIOLATION: security/deterministic/hardcoded-sql-expression
export function hardcodedSql() {
  const format = (s: string, ...args: unknown[]) => s;
  return format("SELECT * FROM users WHERE id = %s", 42);
}
