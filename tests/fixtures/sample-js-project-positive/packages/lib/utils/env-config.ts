
// --- redundant-optional FP: Record<string, string | undefined> — | undefined is intentional ---
// Environment variables are always string | undefined — this is not redundant
declare global {
  interface Window {
    __ENV__?: Record<string, string | undefined>;
  }
}

type EnvKey = string;
type EnvValue = string | undefined;

function getEnv(key: EnvKey): EnvValue {
  if (typeof window !== 'undefined' && window.__ENV__) {
    return window.__ENV__[key];
  }
  return (process.env as Record<string, string | undefined>)[key];
}

export const env = getEnv;
