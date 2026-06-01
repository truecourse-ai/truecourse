/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time flag: enterprise client code is included in this build.
   *  Set in dev and enterprise builds; absent/false in community builds
   *  so the ee chunk is tree-shaken out. See vite.config + loadEeModule. */
  readonly VITE_TC_EE?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
