// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The workspace-level fake data: who is signed in, the two workspaces the
 * switcher offers, the members and plan of the active one, the provider
 * connections, the durable notification feed, the jobs in flight, and the
 * operator's cross-workspace lists.
 */

import type {
  AdminJob,
  AdminTrace,
  ConnectableRepo,
  Entitlement,
  JobChain,
  Member,
  ModelsConfig,
  PreviewNotification,
  PreviewUser,
  ProviderConnection,
  ProviderId,
  Workspace,
} from './types';

export const WORKSPACES: Workspace[] = [
  { id: 'acme', name: 'Acme Payments', initial: 'A', plan: 'Team', repoCount: 4 },
  { id: 'sandbox', name: 'Sandbox', initial: 'S', plan: 'Free', repoCount: 1 },
];

export const ACTIVE_WORKSPACE_ID = 'acme';

export const USER: PreviewUser = {
  name: 'Mushegh G.',
  email: 'mushegh@acme.dev',
  initial: 'M',
  isOperator: true,
  role: 'admin',
};

export const MEMBERS: Member[] = [
  { id: 'm1', name: 'Mushegh G.', email: 'mushegh@acme.dev', role: 'admin', joined: 'Feb 2026' },
  { id: 'm2', name: 'Dana Rees', email: 'dana@acme.dev', role: 'admin', joined: 'Mar 2026' },
  { id: 'm3', name: 'Tomas Berg', email: 'tomas@acme.dev', role: 'member', joined: 'Apr 2026' },
  { id: 'm4', name: 'Priya Nair', email: 'priya@acme.dev', role: 'member', joined: 'Jun 2026' },
];

export const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  azure: 'Azure DevOps',
};

export const PROVIDER_CONNECTIONS: ProviderConnection[] = [
  {
    id: 'gh-acme',
    provider: 'github',
    account: 'acme',
    kind: 'organization',
    repoCount: 31,
    about: 'The TrueCourse app is installed on the acme organization.',
    connectedAt: '3 months ago',
  },
  {
    id: 'gl-acme',
    provider: 'gitlab',
    account: 'acme-group',
    kind: 'group',
    repoCount: 6,
    about: 'Group authorization on the self-managed GitLab at git.acme.dev.',
    connectedAt: '6 weeks ago',
  },
  {
    id: 'az-platform',
    provider: 'azure',
    account: 'platform',
    kind: 'project collection',
    repoCount: 4,
    about: 'The TrueCourse app is authorized for the platform project collection.',
    connectedAt: '2 weeks ago',
  },
];

/** What a freshly added connection looks like, per provider, until the real callback lands. */
export const NEW_CONNECTION: Record<ProviderId, Omit<ProviderConnection, 'id' | 'connectedAt'>> = {
  github: {
    provider: 'github',
    account: 'mushegh',
    kind: 'personal',
    repoCount: 4,
    about: 'The TrueCourse app is installed on a personal account.',
  },
  gitlab: {
    provider: 'gitlab',
    account: 'acme-mobile',
    kind: 'group',
    repoCount: 3,
    about: 'Group authorization on gitlab.com.',
  },
  azure: {
    provider: 'azure',
    account: 'data-eng',
    kind: 'project collection',
    repoCount: 2,
    about: 'The TrueCourse app is authorized for the data-eng project collection.',
  },
};

/** The repositories a freshly added connection can see, so the picker is never empty. */
export const NEW_CONNECTION_REPOS: Record<ProviderId, Omit<ConnectableRepo, 'connectionId'>[]> = {
  github: [
    { fullName: 'mushegh/dotfiles', provider: 'github', visibility: 'public', defaultBranch: 'main', about: 'Shell and editor setup.' },
    { fullName: 'mushegh/recipe-cli', provider: 'github', visibility: 'private', defaultBranch: 'main', about: 'A small CLI side project.' },
  ],
  gitlab: [
    { fullName: 'acme-mobile/ios-app', provider: 'gitlab', visibility: 'private', defaultBranch: 'main', about: 'The iOS client.' },
    { fullName: 'acme-mobile/android-app', provider: 'gitlab', visibility: 'private', defaultBranch: 'main', about: 'The Android client.' },
  ],
  azure: [
    { fullName: 'data-eng/etl-jobs', provider: 'azure', visibility: 'private', defaultBranch: 'main', about: 'Nightly ETL pipelines.' },
  ],
};

export const CONNECTABLE_REPOS: ConnectableRepo[] = [
  {
    fullName: 'acme/payments-ledger',
    provider: 'github',
    connectionId: 'gh-acme',
    visibility: 'private',
    defaultBranch: 'main',
    about: 'Double-entry ledger service.',
  },
  {
    fullName: 'acme/notify-worker',
    provider: 'github',
    connectionId: 'gh-acme',
    visibility: 'private',
    defaultBranch: 'main',
    about: 'Outbound e-mail and webhook worker.',
  },
  {
    fullName: 'acme/design-tokens',
    provider: 'github',
    connectionId: 'gh-acme',
    visibility: 'public',
    defaultBranch: 'main',
    about: 'Shared token package.',
  },
  {
    fullName: 'acme/status-page',
    provider: 'github',
    connectionId: 'gh-acme',
    visibility: 'public',
    defaultBranch: 'trunk',
    about: 'Public incident status site.',
  },
  {
    fullName: 'acme-group/warehouse-sync',
    provider: 'gitlab',
    connectionId: 'gl-acme',
    visibility: 'private',
    defaultBranch: 'main',
    about: 'Nightly warehouse replication jobs.',
  },
  {
    fullName: 'acme-group/pricing-rules',
    provider: 'gitlab',
    connectionId: 'gl-acme',
    visibility: 'private',
    defaultBranch: 'main',
    about: 'Rule engine for regional pricing.',
  },
  {
    fullName: 'platform/release-bot',
    provider: 'azure',
    connectionId: 'az-platform',
    visibility: 'private',
    defaultBranch: 'main',
    about: 'Release automation for the platform collection.',
  },
];

/** The plan allowance line the picker shows above the checkbox list. */
export const PRIVATE_REPO_ALLOWANCE = { used: 3, limit: 5 };

export const ENTITLEMENTS: Entitlement[] = [
  { label: 'Private repositories', value: '3 of 5 used', locked: false },
  { label: 'Seats', value: '4 of 10 used', locked: false },
  { label: 'Metered LLM allowance', value: '18.40 of 50.00 used this month', locked: false },
  { label: 'Evidence retention', value: '90 days', locked: false },
  { label: 'SSO and SCIM', value: 'Enterprise plan', locked: true },
  { label: 'Jira and Confluence connectors', value: 'Enterprise plan', locked: true },
];

export const MODELS_CONFIG: ModelsConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  maskedKey: 'sk-ant-api03-••••••••••••4f2a',
  allowanceUsed: '18.40',
  allowanceLeft: '31.60',
  allowancePlan: 'Team',
};

export const JOBS_IN_FLIGHT: JobChain[] = [
  {
    id: 'job-onboard-billing',
    title: 'Onboarding acme/billing',
    repoFullName: 'acme/billing',
    steps: [
      { key: 'clone', label: 'Clone and index', state: 'done' },
      { key: 'scan', label: 'Scan the spec corpus', state: 'done' },
      { key: 'setup', label: 'Guard setup', state: 'done' },
      { key: 'generate', label: 'Generate scenarios', state: 'active', counter: 'generating 12 of 31 flows' },
      { key: 'baseline', label: 'Baseline run', state: 'pending' },
    ],
  },
];

export const NOTIFICATIONS: PreviewNotification[] = [
  {
    id: 'n1',
    level: 'failure',
    title: 'Gate failed on acme/orders-api #482',
    body: '3 new failures versus base. Refund on a partially captured order returns 409.',
    at: '11 minutes ago',
    read: false,
  },
  {
    id: 'n2',
    level: 'blocked',
    title: 'Conflicts blocked generation on acme/web-console',
    body: 'Two sections disagree on the checkout timeout. Resolve them in the spec decisions.',
    at: '1 hour ago',
    read: false,
  },
  {
    id: 'n3',
    level: 'neutral',
    title: 'Spec changed in acme/orders-api #486',
    body: 'docs/orders/refunds.md changed. Regenerate scenarios for this head and re-gate?',
    at: '3 hours ago',
    read: true,
  },
  {
    id: 'n4',
    level: 'success',
    title: 'Onboarding finished for platform/devops-tools',
    body: '31 flows generated, baseline recorded on 4b1e77c.',
    at: 'Yesterday',
    read: true,
  },
  {
    id: 'n5',
    level: 'success',
    title: 'Baseline refreshed on acme/web-console',
    body: 'main moved to 9d20b41. 44 scenarios re-run, 2 unchanged failures.',
    at: '2 days ago',
    read: true,
  },
  {
    id: 'n6',
    level: 'neutral',
    title: 'Local run uploaded by tomas',
    body: 'acme/orders-api at c71d0aa, dirty tree, 18 passed and 2 failed.',
    at: '2 days ago',
    read: true,
  },
];

export const ADMIN_JOBS: AdminJob[] = [
  { id: 'j1', type: 'repo.onboard', key: 'acme/billing', workspace: 'Acme Payments', status: 'running', duration: '6m 12s' },
  { id: 'j2', type: 'gate.run', key: 'acme/orders-api#482', workspace: 'Acme Payments', status: 'succeeded', duration: '2m 41s' },
  { id: 'j3', type: 'baseline.refresh', key: 'acme/web-console@9d20b41', workspace: 'Acme Payments', status: 'succeeded', duration: '4m 03s' },
  { id: 'j4', type: 'spec.scan', key: 'northwind/checkout', workspace: 'Northwind', status: 'failed', duration: '1m 18s' },
  { id: 'j5', type: 'guard.generate', key: 'northwind/checkout', workspace: 'Northwind', status: 'queued', duration: 'not started' },
  { id: 'j6', type: 'gate.run', key: 'platform/devops-tools#95', workspace: 'Acme Payments', status: 'succeeded', duration: '1m 52s' },
  { id: 'j7', type: 'run.judge', key: 'acme/web-console@2f9ac30', workspace: 'Acme Payments', status: 'running', duration: '52s' },
  { id: 'j8', type: 'repo.unlink', key: 'northwind/legacy-api', workspace: 'Northwind', status: 'succeeded', duration: '4s' },
];

export const ADMIN_TRACES: AdminTrace[] = [
  { id: 't1', model: 'claude-opus-4-6', stage: 'contract/extract', tokensIn: 184_220, tokensOut: 12_940, cost: '$2.94', workspace: 'Acme Payments', at: '8 minutes ago' },
  { id: 't2', model: 'claude-sonnet-4-6', stage: 'consolidator/area-tags', tokensIn: 42_180, tokensOut: 3_110, cost: '$0.19', workspace: 'Acme Payments', at: '9 minutes ago' },
  { id: 't3', model: 'claude-opus-4-6', stage: 'guard/triage', tokensIn: 61_450, tokensOut: 5_002, cost: '$1.02', workspace: 'Acme Payments', at: '22 minutes ago' },
  { id: 't4', model: 'claude-sonnet-4-6', stage: 'interfaces/author', tokensIn: 91_330, tokensOut: 8_760, cost: '$0.44', workspace: 'Northwind', at: '41 minutes ago' },
  { id: 't5', model: 'claude-opus-4-6', stage: 'guard/visual-judge', tokensIn: 22_015, tokensOut: 1_204, cost: '$0.38', workspace: 'Acme Payments', at: '1 hour ago' },
  { id: 't6', model: 'claude-sonnet-4-6', stage: 'consolidator/relevance', tokensIn: 15_880, tokensOut: 940, cost: '$0.07', workspace: 'Northwind', at: '2 hours ago' },
  { id: 't7', model: 'claude-opus-4-6', stage: 'contract/reconcile', tokensIn: 130_770, tokensOut: 9_512, cost: '$2.21', workspace: 'Acme Payments', at: '3 hours ago' },
  { id: 't8', model: 'claude-sonnet-4-6', stage: 'consolidator/overlap', tokensIn: 28_640, tokensOut: 2_006, cost: '$0.13', workspace: 'Acme Payments', at: '4 hours ago' },
];
