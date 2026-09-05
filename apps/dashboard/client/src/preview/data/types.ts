/**
 * The shapes the preview renders from. They are NOT the wire types of the real
 * product: they are the smallest honest description of what each screen shows,
 * so a reader can tell at a glance which facts the one-product dashboard has to
 * carry. Nothing here is persisted and nothing is fetched.
 */

export type ProviderId = 'github' | 'gitlab' | 'azure';

export type GatePolicy = 'blocking' | 'advisory';

/** A check's conclusion. An error is reported as a failure, never as neutral. */
export type CheckConclusion = 'success' | 'failure' | 'neutral';

/** Where a run executed. The gate's verdict only ever comes from `hosted`. */
export type RunOrigin = 'hosted' | 'local';

export type StepDriver = 'cli' | 'api' | 'web';

export type TestStatus = 'passing' | 'failing' | 'blocked' | 'not-testable' | 'never-run';

export type InterfaceSurface = 'cli' | 'api' | 'web';

export type InterfaceOrigin = 'derived' | 'authored';

export type DependencyClass = 'step-creatable' | 'seedable' | 'supplied';

export type PullRequestState = 'open' | 'merged' | 'closed';

export type PlanName = 'Free' | 'Team' | 'Enterprise';

export interface Workspace {
  id: string;
  name: string;
  /** The switcher's avatar-less initial. */
  initial: string;
  plan: PlanName;
  repoCount: number;
}

export interface PreviewUser {
  name: string;
  email: string;
  initial: string;
  /** Operators see the Admin entry. */
  isOperator: boolean;
  role: 'admin' | 'member';
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  joined: string;
}

export interface Repo {
  /** The URL slug of the repo console. */
  id: string;
  fullName: string;
  provider: ProviderId;
  visibility: 'public' | 'private';
  defaultBranch: string;
  policy: GatePolicy;
  /** The commit the current baseline was recorded on. */
  baselineSha: string;
  baselineAt: string;
  notifyEmails: string[];
  lastCheck: {
    conclusion: CheckConclusion;
    word: string;
    summary: string;
    at: string;
  };
  /** True while the onboarding chain is still running on this repo. */
  onboarding: boolean;
  /** A connected repository's spec scan is running (its first, or a rescan). */
  scanning?: boolean;
  /**
   * Set on a repository that really exists on the server (connected through a
   * provider), as opposed to a fixture. Unlinking one is a real delete, and
   * none of the guard fixtures are keyed by its slug.
   */
  real?: true;
}

export interface LocalRunFacts {
  user: string;
  os: string;
  dirtyTree: boolean;
  ranInCi: boolean;
}

export interface RunTestVerdict {
  testId: string;
  name: string;
  verdict: 'passed' | 'failed' | 'blocked';
  /** The step the run stopped at, for a failure. */
  detail?: string;
}

export interface Run {
  id: string;
  repoId: string;
  /** Set when the run was recorded against a pull request head. */
  prNumber?: number;
  sha: string;
  branch: string;
  origin: RunOrigin;
  at: string;
  verdict: CheckConclusion;
  passed: number;
  failed: number;
  blocked: number;
  duration: string;
  local?: LocalRunFacts;
  tests: RunTestVerdict[];
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  state: PullRequestState;
  updated: string;
  fork: boolean;
  /** The one check the gate posts. */
  check: {
    name: string;
    conclusion: CheckConclusion;
    word: string;
    summary: string;
    scope: 'impacted' | 'full';
    note?: string;
  };
  /** A spec file changed in this pull request: the regenerate offer. */
  specOffer?: {
    files: string[];
    label: string;
  };
}

export interface TestStep {
  id: string;
  driver: StepDriver;
  title: string;
  /** The step's invocation, verbatim, for a PRE block. */
  invocation: string;
  expected: string;
  actual: string;
  ok: boolean;
  milestone: string;
  claim: string;
  specRef: string;
}

export interface EvidenceTile {
  id: string;
  label: string;
  at: string;
}

export interface GuardTest {
  id: string;
  name: string;
  area: string;
  status: TestStatus;
  drivers: StepDriver[];
  flow: string;
  lastRun: {
    origin: RunOrigin;
    sha: string;
    at: string;
    runId: string;
  } | null;
  /** Why a blocked or not-testable test is not running. */
  reason?: string;
  steps: TestStep[];
  evidence: EvidenceTile[];
  transcript: string;
  interfacesUsed: string[];
  facts: { label: string; value: string }[];
}

export interface CliGrammarFlag {
  name: string;
  required: boolean;
  choices?: string[];
  about: string;
}

export interface ApiField {
  name: string;
  type: string;
  required: boolean;
  about: string;
}

export interface WebTaskStep {
  order: number;
  action: string;
  target: string;
}

export interface GuardInterface {
  id: string;
  surface: InterfaceSurface;
  /** The family sub-group inside the surface: "orders", "auth", "checkout". */
  family: string;
  kind: string;
  fingerprint: string;
  origin: InterfaceOrigin;
  summary: string;
  cli?: {
    command: string;
    flags: CliGrammarFlag[];
    consumes: string[];
    produces: string[];
  };
  api?: {
    method: string;
    path: string;
    request: ApiField[];
    response: ApiField[];
  };
  web?: {
    place: string;
    address: string;
    steps: WebTaskStep[];
    endsIn: string;
  };
}

export interface SurfaceRecipe {
  surface: InterfaceSurface;
  label: string;
  steps: string[];
}

export interface SourcePage {
  id: string;
  title: string;
  url: string;
  fetchedAt: string;
  /** Markdown-ish body, rendered as plain headings and paragraphs. */
  body: string;
}

export interface DocSource {
  id: string;
  title: string;
  llmsTxtUrl: string;
  fetchedAt: string;
  pages: SourcePage[];
}

export interface Dependency {
  id: string;
  name: string;
  klass: DependencyClass;
  service: string;
  envVars: string[];
  evidence: string[];
  about: string;
  /** A supplied dependency whose values are already stored. */
  storedHint?: string;
}

export interface CompositionSlice {
  key: string;
  word: string;
  count: number;
  /** Tailwind background class for the slice. */
  cls: string;
}

export interface CompositionBar {
  id: string;
  label: string;
  total: number;
  slices: CompositionSlice[];
}

export interface CoverageView {
  bars: CompositionBar[];
  freshness: { label: string; value: string }[];
}

export interface RepoGuardData {
  areas: string[];
  tests: GuardTest[];
  interfaces: GuardInterface[];
  recipes: SurfaceRecipe[];
  runs: Run[];
  sources: DocSource[];
  dependencies: Dependency[];
  coverage: CoverageView;
}

export interface JobStep {
  key: string;
  label: string;
  state: 'done' | 'active' | 'pending';
  /** The moving counter text of the active step. Never a bar. */
  counter?: string;
}

export interface JobChain {
  id: string;
  title: string;
  repoFullName: string;
  steps: JobStep[];
  /**
   * Where the job is watched, when it has an address of its own. A real run
   * carries the repository's Activity; a fixture leaves it out and the toast
   * falls back to the repository named on the job.
   */
  href?: string;
}

export interface PreviewNotification {
  id: string;
  level: 'success' | 'failure' | 'blocked' | 'neutral';
  title: string;
  body: string;
  at: string;
  read: boolean;
  /** Where the row opens, for a notification that has a place to go. */
  href?: string;
}

export interface AdminJob {
  id: string;
  type: string;
  key: string;
  workspace: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  duration: string;
}

export interface AdminTrace {
  id: string;
  model: string;
  stage: string;
  tokensIn: number;
  tokensOut: number;
  cost: string;
  workspace: string;
  at: string;
}

export type ConnectionKind = 'organization' | 'personal' | 'group' | 'project collection';

/**
 * One authorization of a provider for this workspace: a GitHub App installation
 * on an organization or a personal account, a GitLab group, an Azure DevOps
 * project collection. A workspace holds as many as it needs, several per
 * provider; a repository belongs to exactly one.
 */
export interface ProviderConnection {
  id: string;
  provider: ProviderId;
  account: string;
  kind: ConnectionKind;
  repoCount: number;
  about: string;
  connectedAt: string;
}

export interface ConnectableRepo {
  fullName: string;
  provider: ProviderId;
  /** The connection that can see it. */
  connectionId: string;
  visibility: 'public' | 'private';
  defaultBranch: string;
  about: string;
}

export interface Entitlement {
  label: string;
  value: string;
  locked: boolean;
}

export interface ModelsConfig {
  provider: 'anthropic' | 'openai' | 'bedrock';
  model: string;
  maskedKey: string;
  allowanceUsed: string;
  allowanceLeft: string;
  allowancePlan: string;
}
