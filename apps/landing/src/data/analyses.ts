export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type Finding = {
  rule: string;
  category: string;
  count: number;
  severity: Severity;
};

export type AnalysisReport = {
  slug: string;
  repo: string;
  repoUrl: string;
  description: string;
  language: 'TypeScript' | 'JavaScript' | 'Python' | 'Mixed';
  stars: string;
  analyzedAt: string;
  files: number;
  loc: string;
  duration: string;
  totals: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topFindings: Finding[];
  summary: string;
  reportUrl?: string;
  featured?: boolean;
};

/**
 * Sample analysis reports — replace these with real results once you've
 * run `truecourse analyze` against each repository. Keep entries short:
 * the cards on the landing page show a 3-line summary + top 4 findings.
 */
export const ANALYSIS_REPORTS: AnalysisReport[] = [
  {
    slug: 'react',
    repo: 'facebook/react',
    repoUrl: 'https://github.com/facebook/react',
    description: 'The library for web and native user interfaces.',
    language: 'JavaScript',
    stars: '230k',
    analyzedAt: '2026-04-22',
    files: 4218,
    loc: '512k',
    duration: '2m 14s',
    totals: { critical: 0, high: 7, medium: 142, low: 318 },
    topFindings: [
      { rule: 'cognitive-complexity', category: 'code-quality', count: 64, severity: 'medium' },
      { rule: 'magic-numbers', category: 'code-quality', count: 38, severity: 'low' },
      { rule: 'large-function', category: 'code-quality', count: 22, severity: 'medium' },
      { rule: 'cross-package-import', category: 'architecture', count: 7, severity: 'high' },
    ],
    summary:
      'Surprisingly clean for its size. Most findings are deliberate choices in the reconciler: long functions sitting at the hot path. Zero criticals.',
    featured: true,
  },
  {
    slug: 'vite',
    repo: 'vitejs/vite',
    repoUrl: 'https://github.com/vitejs/vite',
    description: 'Next-generation frontend tooling.',
    language: 'TypeScript',
    stars: '74k',
    analyzedAt: '2026-04-24',
    files: 1062,
    loc: '128k',
    duration: '38s',
    totals: { critical: 0, high: 3, medium: 71, low: 184 },
    topFindings: [
      { rule: 'unhandled-promise', category: 'reliability', count: 18, severity: 'medium' },
      { rule: 'console-log', category: 'code-quality', count: 14, severity: 'low' },
      { rule: 'missing-await', category: 'bugs', count: 9, severity: 'medium' },
      { rule: 'tight-coupling', category: 'architecture', count: 3, severity: 'high' },
    ],
    summary:
      'Three high-severity coupling issues between the dev-server and plugin host. Likely candidates for a layer extraction. Otherwise tidy.',
    featured: true,
  },
  {
    slug: 'fastapi',
    repo: 'tiangolo/fastapi',
    repoUrl: 'https://github.com/tiangolo/fastapi',
    description: 'Modern, fast web framework for building APIs with Python.',
    language: 'Python',
    stars: '79k',
    analyzedAt: '2026-04-26',
    files: 612,
    loc: '94k',
    duration: '24s',
    totals: { critical: 1, high: 4, medium: 53, low: 122 },
    topFindings: [
      { rule: 'mutable-default-argument', category: 'bugs', count: 6, severity: 'high' },
      { rule: 'missing-type-hints', category: 'code-quality', count: 41, severity: 'low' },
      { rule: 'broad-exception-catch', category: 'reliability', count: 12, severity: 'medium' },
      { rule: 'sync-io-in-async', category: 'performance', count: 1, severity: 'critical' },
    ],
    summary:
      'One blocking sync call inside an async path. A real latency tax under load. Mutable defaults appear in test scaffolding only.',
  },
  {
    slug: 'next',
    repo: 'vercel/next.js',
    repoUrl: 'https://github.com/vercel/next.js',
    description: 'The React framework for production.',
    language: 'TypeScript',
    stars: '128k',
    analyzedAt: '2026-04-28',
    files: 5871,
    loc: '742k',
    duration: '4m 02s',
    totals: { critical: 0, high: 12, medium: 218, low: 487 },
    topFindings: [
      { rule: 'circular-dependency', category: 'architecture', count: 9, severity: 'high' },
      { rule: 'cognitive-complexity', category: 'code-quality', count: 96, severity: 'medium' },
      { rule: 'unused-export', category: 'code-quality', count: 71, severity: 'low' },
      { rule: 'race-condition', category: 'bugs', count: 3, severity: 'high' },
    ],
    summary:
      'Nine circular dependency clusters, all between the app router and the build pipeline. Three suspected race conditions worth a closer look.',
  },
  {
    slug: 'astro',
    repo: 'withastro/astro',
    repoUrl: 'https://github.com/withastro/astro',
    description: 'The web framework for content-driven websites.',
    language: 'TypeScript',
    stars: '47k',
    analyzedAt: '2026-04-30',
    files: 1944,
    loc: '218k',
    duration: '1m 08s',
    totals: { critical: 0, high: 2, medium: 88, low: 211 },
    topFindings: [
      { rule: 'large-file', category: 'code-quality', count: 28, severity: 'low' },
      { rule: 'unhandled-promise', category: 'reliability', count: 11, severity: 'medium' },
      { rule: 'missing-error-boundary', category: 'reliability', count: 6, severity: 'medium' },
      { rule: 'layer-violation', category: 'architecture', count: 2, severity: 'high' },
    ],
    summary:
      'Two layer violations crossing the build / runtime boundary. Small but worth tightening before they spread.',
  },
  {
    slug: 'tailwindcss',
    repo: 'tailwindlabs/tailwindcss',
    repoUrl: 'https://github.com/tailwindlabs/tailwindcss',
    description: 'A utility-first CSS framework.',
    language: 'TypeScript',
    stars: '83k',
    analyzedAt: '2026-05-02',
    files: 482,
    loc: '64k',
    duration: '18s',
    totals: { critical: 0, high: 1, medium: 27, low: 88 },
    topFindings: [
      { rule: 'cognitive-complexity', category: 'code-quality', count: 14, severity: 'medium' },
      { rule: 'magic-numbers', category: 'code-quality', count: 22, severity: 'low' },
      { rule: 'tight-coupling', category: 'architecture', count: 1, severity: 'high' },
      { rule: 'unused-import', category: 'code-quality', count: 9, severity: 'low' },
    ],
    summary:
      'Almost spotless. The single high finding is a tight coupling between the parser and the candidate engine. Likely intentional.',
  },
];
