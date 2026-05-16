/// <reference types="node" />

/**
 * Typed access to process.env. The triple-slash reference above pulls in
 * Node's ambient definitions so that NodeJS.ProcessEnv exists and can be
 * augmented below — this cannot be expressed with a regular `import`
 * because module imports do not contribute to the ambient global namespace.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      readonly APP_PORT?: string;
      readonly APP_HOST?: string;
      readonly DATABASE_URL?: string;
      readonly APP_PUBLIC_API_BASE?: string;
    }
  }

  interface Window {
    __APP_ENV__?: Record<string, string | undefined>;
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
type EnvKey = keyof NodeJS.ProcessEnv | (string & {});
type EnvValue<K extends EnvKey> = K extends keyof NodeJS.ProcessEnv
  ? NodeJS.ProcessEnv[K]
  : string | undefined;

export const readEnv = <K extends EnvKey>(name: K): EnvValue<K> => {
  if (typeof window !== 'undefined' && typeof window.__APP_ENV__ === 'object') {
    return window.__APP_ENV__[name as string] as EnvValue<K>;
  }
  return (typeof process !== 'undefined' ? process?.env?.[name] : undefined) as EnvValue<K>;
};

export const collectPublicEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('APP_PUBLIC_')),
  );

export {};


// FP: alias inside declare global { namespace PrismaJson } — required by prisma-json-types-generator
// to bind JSON column types. Not a stylistic alias.
declare global {
  namespace PrismaJson {
    type ContactAuthOptions = {
      accessLevel: string | null;
      actionPermissions: string | null;
    };
  }
}

