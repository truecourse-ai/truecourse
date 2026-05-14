import type { ExtractorMetadata } from '@truecourse/shared'

export const EXTRACTORS = {
  express: { name: 'express-route-extractor', version: '1.0.0' },
  auth: { name: 'auth-signal-extractor', version: '1.0.0' },
  react: { name: 'react-route-extractor', version: '1.0.0' },
  jsxText: { name: 'jsx-visible-text-extractor', version: '1.0.0' },
  jsxForm: { name: 'jsx-form-extractor', version: '1.0.0' },
  env: { name: 'env-var-extractor', version: '1.0.0' },
  packageManifest: { name: 'package-manifest-extractor', version: '1.0.0' },
  testHint: { name: 'test-hint-extractor', version: '1.0.0' },
  schema: { name: 'schema-fact-extractor', version: '1.0.0' },
  infraConfig: { name: 'infra-config-extractor', version: '1.0.0' },
} satisfies Record<string, ExtractorMetadata>

export const SPEC_CODE_FACT_EXTRACTORS = [
  EXTRACTORS.express,
  EXTRACTORS.auth,
  EXTRACTORS.react,
  EXTRACTORS.jsxText,
  EXTRACTORS.jsxForm,
  EXTRACTORS.env,
  EXTRACTORS.packageManifest,
  EXTRACTORS.testHint,
  EXTRACTORS.schema,
  EXTRACTORS.infraConfig,
]
