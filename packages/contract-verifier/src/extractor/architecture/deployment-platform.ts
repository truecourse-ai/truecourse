import type { ArchitectureDetector } from './types.js';
import { detectByChoiceSpecs, type ChoiceSpec } from './shared/detect.js';

const SPECS: ChoiceSpec[] = [
  { value: 'vercel', configGlobs: ['vercel.json'] },
  { value: 'netlify', configGlobs: ['netlify.toml'] },
  { value: 'fly', configGlobs: ['fly.toml'] },
  { value: 'cloudflare', configGlobs: ['wrangler.toml', 'wrangler.json'] },
  { value: 'heroku', configGlobs: ['Procfile', 'app.json'] },
  { value: 'render', configGlobs: ['render.yaml'] },
  {
    value: 'aws',
    configContent: { globs: ['serverless.yml', 'serverless.yaml'], pattern: /provider:\s*\n?\s*name:\s*aws|provider:\s*aws/ },
  },
  { value: 'self-hosted-docker', configGlobs: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml'] },
];

export const deploymentPlatformDetector: ArchitectureDetector = {
  category: 'deployment-platform',
  alternatives: [
    'aws', 'gcp', 'azure', 'vercel', 'netlify', 'cloudflare', 'fly',
    'railway', 'render', 'heroku', 'self-hosted-k8s', 'self-hosted-docker',
  ],
  // No deploy config found ⇒ undeterminable rather than a false default.
  detect: (scan, scope) => detectByChoiceSpecs('deployment-platform', scan, SPECS, { scope }),
};
