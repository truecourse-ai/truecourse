/**
 * `declare namespace …` is the canonical TS pattern for augmenting global
 * or third-party types — the ES module equivalent does not exist. These
 * ambient namespace declarations should not be flagged as deprecated
 * namespace usage.
 */

declare namespace AppRuntime {
  interface RuntimeEnv {
    SERVICE_NAME?: string;
    LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  }
  interface ServiceClient {
    name: string;
    invoke(): Promise<void>;
  }
}

declare namespace ThirdPartyBridge {
  type FeatureFlags = { admin: boolean };
  type AuthOptions = { method: 'password' | 'sms' };
}

export type RuntimeEnv = AppRuntime.RuntimeEnv;
export type FeatureFlags = ThirdPartyBridge.FeatureFlags;
