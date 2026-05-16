/// <reference types="bundler/client" />

type BundlerImportMetaEnv = {
  readonly BUNDLER_PUBLIC_API_URL: string;
  readonly BUNDLER_PUBLIC_APP_NAME: string;
};

interface BundlerImportMeta {
  readonly env: BundlerImportMetaEnv;
}
