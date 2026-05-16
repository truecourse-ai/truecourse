export type AppConfig = Record<string, unknown>;
export function convertValues(s: string, n: number, b: boolean): { s: string; n: number; b: boolean } {
  return { s, n, b };
}
export class Config {
  private readonly _timeout = 5000;
  get timeout(): number { return this._timeout; }
}
export function handleAction(action: string): number {
  if (action === 'start') return 1;
  if (action === 'stop') return 2;
  return 0;
}
export class ConfigStore {
  private readonly store = new Map<string, string>();
  getValue(): string { return this.store.get('current') ?? 'default'; }
}


// Type alias inside declare global namespace required by prisma-json-types-generator for JSON column binding
declare namespace OrmJsonTypes {
  interface DefaultSignerConfig {
    name: string;
    email: string;
    role: 'signer' | 'viewer' | 'approver';
    accessCode?: string;
  }
}

declare global {
  namespace PrismaJson {
    type DefaultSignerConfig = OrmJsonTypes.DefaultSignerConfig;
  }
}

