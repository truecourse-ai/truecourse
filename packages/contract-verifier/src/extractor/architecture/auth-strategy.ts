import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'session-cookie', packages: ['express-session', 'cookie-session', '@fastify/session'] },
  { value: 'jwt', packages: ['jsonwebtoken', 'jose', '@nestjs/jwt'], imports: ['jsonwebtoken', 'jose'] },
  { value: 'oauth2', packages: ['passport-oauth2', 'simple-oauth2', 'openid-client'] },
  { value: 'auth0', packages: ['@auth0/auth0-react', '@auth0/nextjs-auth0', 'express-openid-connect'] },
  { value: 'clerk', packages: ['@clerk/nextjs', '@clerk/clerk-sdk-node', '@clerk/backend'] },
  { value: 'supabase', packages: ['@supabase/supabase-js'] },
  { value: 'cognito', packages: ['amazon-cognito-identity-js', '@aws-sdk/client-cognito-identity-provider'] },
];

export const authStrategyDetector: ArchitectureDetector = {
  category: 'auth-strategy',
  alternatives: [...SPECS.map((s) => s.value), 'api-key', 'none'],
  detect: (scan, scope) => detectByChoiceSpecs('auth-strategy', scan, SPECS, { scope, absenceValue: 'none' }),
};
