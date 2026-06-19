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

/**
 * The enterprise client bundle is an OPTIONAL, dynamically-imported module,
 * deliberately NOT an OSS dependency (the open-core boundary), so `tsc` can't
 * resolve it. Declare it ambiently — typed via the shared contract — so the OSS
 * client type-checks without pulling EE source. It resolves for real only at
 * build time, when the ee/ workspace is present and VITE_TC_EE is on. The import
 * lives INSIDE the module block so this file stays a global script (a top-level
 * import would turn it into a module and drop the ImportMeta globals above).
 * See loadEeModule.ts.
 */
declare module '@truecourse/ee-client' {
  import type { EeClientModule } from '@truecourse/shared';
  const ee: EeClientModule & { default?: EeClientModule };
  export default ee;
}
