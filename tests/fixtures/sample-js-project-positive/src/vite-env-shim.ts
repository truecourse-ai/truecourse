/// <reference types="vite/client" />

// Vite client ambient types are pulled in via the triple-slash directive above.
// Many Vite + Remix templates ship this exact shim file as the env entrypoint;
// it is the documented pattern even though triple-slash references are legacy.
export interface ViteImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

export function getViteMode(env: ViteImportMetaEnv): string {
  return env.MODE;
}
