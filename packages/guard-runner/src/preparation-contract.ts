/** Shared by the runner and the preparation author's executable input example. */
export const PREPARATION_VERIFY_ENV = {
  peer: 'GUARD_PREPARATION_PEER_ENV',
  fixtures: 'GUARD_PREPARATION_FIXTURES',
  peerFixtures: 'GUARD_PREPARATION_PEER_FIXTURES',
  credentials: 'GUARD_PREPARATION_CREDENTIALS',
  peerCredentials: 'GUARD_PREPARATION_PEER_CREDENTIALS',
} as const;

/** Standalone ES-module source: generated scripts run inside the target app. */
export const PREPARATION_VERIFY_INPUTS_SOURCE = `function requiredPreparationJson(name) {
  const raw = process.env[name];
  if (!raw) throw new Error('Missing preparation input: ' + name);
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('Invalid preparation JSON: ' + name); }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Preparation input must be an object: ' + name);
  return value;
}
${Object.entries(PREPARATION_VERIFY_ENV).map(([variable, name]) => `const ${variable} = requiredPreparationJson('${name}');`).join('\n')}
function requiredPreparationCredential(worldCredentials, name) {
  const value = worldCredentials[name]?.value;
  if (typeof value !== 'string' || !value.trim())
    throw new Error('Missing preparation credential: ' + name);
  return value;
}`;
