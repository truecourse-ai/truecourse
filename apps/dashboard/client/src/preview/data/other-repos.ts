/**
 * The guard data of the three repositories that are not acme/orders-api. They
 * are written at one step less detail (one step record per test rather than
 * three) because their job in the preview is to prove the surfaces are
 * repo-scoped and to give the workspace home real rows, not to be read
 * end to end. acme/billing is deliberately mid-onboarding: it has interfaces
 * and tests but no run at all, which is what a repo looks like an hour in.
 */

import type {
  CoverageView,
  Dependency,
  DocSource,
  GuardInterface,
  GuardTest,
  RepoGuardData,
  Run,
  RunTestVerdict,
  StepDriver,
  SurfaceRecipe,
  TestStatus,
} from './types';

interface TestSeed {
  id: string;
  name: string;
  area: string;
  flow: string;
  status: TestStatus;
  drivers: StepDriver[];
  driver: StepDriver;
  invocation: string;
  expected: string;
  actual: string;
  milestone: string;
  claim: string;
  specRef: string;
  interfacesUsed: string[];
  reason?: string;
}

const TRANSCRIPT: Record<TestStatus, string> = {
  passing: 'No adjudication needed: every step matched its expectation.',
  failing: 'triage: the step observed something the claim rules out. Verdict: the code is wrong, not the test.',
  blocked: 'The run refused to start this scenario. Blocked is not a failure, and it never blocks a merge.',
  'not-testable': 'authoring: no interface observes what the claim states, so no step can be written.',
  'never-run': 'This scenario was generated after the last run finished. It runs on the next board.',
};

function mk(seed: TestSeed, lastRun: GuardTest['lastRun']): GuardTest {
  const ok = seed.status === 'passing';
  return {
    id: seed.id,
    name: seed.name,
    area: seed.area,
    flow: seed.flow,
    status: seed.status,
    drivers: seed.drivers,
    lastRun,
    ...(seed.reason ? { reason: seed.reason } : {}),
    steps: [
      {
        id: `${seed.id}-s1`,
        driver: seed.driver,
        title: seed.milestone,
        invocation: seed.invocation,
        expected: seed.expected,
        actual: seed.actual,
        ok,
        milestone: seed.milestone,
        claim: seed.claim,
        specRef: seed.specRef,
      },
    ],
    evidence:
      seed.status === 'not-testable' || seed.status === 'never-run'
        ? []
        : ['Before', seed.milestone, 'Response', 'After'].map((label, i) => ({
            id: `ev-${i + 1}`,
            label,
            at: lastRun?.at ?? 'not run',
          })),
    transcript: TRANSCRIPT[seed.status],
    interfacesUsed: seed.interfacesUsed,
    facts: [
      { label: 'Flow', value: seed.flow },
      { label: 'Scenario file', value: `scenarios/${seed.area.toLowerCase()}/${seed.id}.yaml` },
      { label: 'Claims bound', value: '1' },
      { label: 'Spec section', value: seed.specRef },
    ],
  };
}

function verdicts(tests: GuardTest[], failed: string[], blocked: string[]): RunTestVerdict[] {
  return tests
    .filter((t) => t.status !== 'never-run' && t.status !== 'not-testable')
    .map((t) => ({
      testId: t.id,
      name: t.name,
      verdict: failed.includes(t.id) ? 'failed' : blocked.includes(t.id) ? 'blocked' : 'passed',
      detail: failed.includes(t.id) ? t.steps[0]?.title : blocked.includes(t.id) ? t.reason : undefined,
    }));
}

function mkRun(
  tests: GuardTest[],
  base: Omit<Run, 'passed' | 'failed' | 'blocked' | 'tests'>,
  failed: string[],
  blocked: string[],
): Run {
  const rows = verdicts(tests, failed, blocked);
  return {
    ...base,
    tests: rows,
    passed: rows.filter((r) => r.verdict === 'passed').length,
    failed: rows.filter((r) => r.verdict === 'failed').length,
    blocked: rows.filter((r) => r.verdict === 'blocked').length,
  };
}

function coverage(
  tests: GuardTest[],
  sections: [number, number, number],
  claims: [number, number, number],
  flows: [number, number, number],
  surfaces: [number, number, number],
  freshness: { label: string; value: string }[],
): CoverageView {
  const by = (s: TestStatus) => tests.filter((t) => t.status === s).length;
  return {
    bars: [
      {
        id: 'sections',
        label: 'Spec sections',
        total: sections[0] + sections[1] + sections[2],
        slices: [
          { key: 'covered', word: 'Covered', count: sections[0], cls: 'bg-emerald-500' },
          { key: 'partial', word: 'Partly covered', count: sections[1], cls: 'bg-amber-500' },
          { key: 'uncovered', word: 'Not covered', count: sections[2], cls: 'bg-muted-foreground/40' },
        ],
      },
      {
        id: 'claims',
        label: 'Claims',
        total: claims[0] + claims[1] + claims[2],
        slices: [
          { key: 'guarded', word: 'Guarded', count: claims[0], cls: 'bg-emerald-500' },
          { key: 'dismissed', word: 'Dismissed', count: claims[1], cls: 'bg-muted-foreground/40' },
          { key: 'open', word: 'Not yet bound', count: claims[2], cls: 'bg-amber-500' },
        ],
      },
      {
        id: 'flows',
        label: 'Flows',
        total: flows[0] + flows[1] + flows[2],
        slices: [
          { key: 'generated', word: 'Generated', count: flows[0], cls: 'bg-emerald-500' },
          { key: 'punted', word: 'Punted', count: flows[1], cls: 'bg-amber-500' },
          { key: 'blocked', word: 'Blocked', count: flows[2], cls: 'bg-muted-foreground/40' },
        ],
      },
      {
        id: 'tests',
        label: 'Tests',
        total: tests.length,
        slices: [
          { key: 'passing', word: 'Passing', count: by('passing'), cls: 'bg-emerald-500' },
          { key: 'failing', word: 'Failing', count: by('failing'), cls: 'bg-red-500' },
          { key: 'blocked', word: 'Blocked', count: by('blocked'), cls: 'bg-amber-500' },
          { key: 'not-testable', word: 'Not testable', count: by('not-testable'), cls: 'bg-muted-foreground/40' },
          { key: 'never-run', word: 'Never run', count: by('never-run'), cls: 'bg-muted-foreground/25' },
        ],
      },
      {
        id: 'surfaces',
        label: 'Interfaces by surface',
        total: surfaces[0] + surfaces[1] + surfaces[2],
        slices: [
          { key: 'cli', word: 'CLI', count: surfaces[0], cls: 'bg-sky-500' },
          { key: 'api', word: 'API', count: surfaces[1], cls: 'bg-indigo-500' },
          { key: 'web', word: 'Web', count: surfaces[2], cls: 'bg-violet-500' },
        ],
      },
    ],
    freshness,
  };
}

// --- acme/web-console -------------------------------------------------------

const WC_RUN = { origin: 'hosted' as const, sha: '9d20b41', at: '2 days ago', runId: 'run-wc-9d20b41' };

const WC_SEEDS: TestSeed[] = [
  { id: 'wc-signin-otp', name: 'Signing in with an expired one-time code is refused', area: 'Sessions', flow: 'Sign in', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'navigate /sign-in\ntype the code 114900\nclick "Continue"', expected: 'the page shows "That code has expired"', actual: 'the page shows "That code has expired"', milestone: 'An expired code never opens a session', claim: 'A one-time code older than 10 minutes is refused.', specRef: 'docs/console/auth.md#otp', interfacesUsed: ['web:sign-in'] },
  { id: 'wc-session-idle', name: 'An idle session signs out after 30 minutes', area: 'Sessions', flow: 'Session lifetime', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'navigate /dashboards\nadvance the clock 31 minutes\nreload', expected: 'the page redirects to /sign-in', actual: 'the page redirects to /sign-in', milestone: 'An abandoned tab does not stay signed in', claim: 'An idle session ends after 30 minutes.', specRef: 'docs/console/auth.md#idle', interfacesUsed: ['web:sign-in'] },
  { id: 'wc-signout-everywhere', name: 'Sign out everywhere drops every device', area: 'Sessions', flow: 'Sign out', status: 'failing', drivers: ['web', 'api'], driver: 'web', invocation: 'navigate /settings/security\nclick "Sign out everywhere"', expected: 'the other device is signed out within one page load', actual: 'the other device stays signed in until its token expires', milestone: 'One click ends every session', claim: 'Sign out everywhere revokes every session immediately.', specRef: 'docs/console/auth.md#revoke', interfacesUsed: ['web:security-page', 'api:delete-sessions'] },
  { id: 'wc-dashboard-share', name: 'A shared dashboard opens read-only for a viewer', area: 'Dashboards', flow: 'Share a dashboard', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'navigate /d/rev-by-store?token=shr_71ac', expected: 'the edit controls are absent', actual: 'the edit controls are absent', milestone: 'A share link cannot edit', claim: 'A shared dashboard is read-only for anyone without a seat.', specRef: 'docs/console/sharing.md#read-only', interfacesUsed: ['web:open-shared-dashboard'] },
  { id: 'wc-dashboard-filters', name: 'Dashboard filters survive a reload', area: 'Dashboards', flow: 'Filter a dashboard', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'navigate /d/rev-by-store\nchoose the store "Kensington"\nreload', expected: 'the store filter still reads Kensington', actual: 'the store filter still reads Kensington', milestone: 'A filter is part of the address', claim: 'Dashboard filters are encoded in the URL.', specRef: 'docs/console/dashboards.md#state', interfacesUsed: ['web:open-dashboard'] },
  { id: 'wc-dashboard-export', name: 'Exporting a dashboard produces a CSV per panel', area: 'Dashboards', flow: 'Export a dashboard', status: 'passing', drivers: ['api'], driver: 'api', invocation: 'GET /api/dashboards/rev-by-store/export?format=csv', expected: '200 OK, a zip with one CSV per panel', actual: '200 OK, a zip with one CSV per panel', milestone: 'Every panel is exportable', claim: 'An export contains one CSV per panel, named after the panel.', specRef: 'docs/console/dashboards.md#export', interfacesUsed: ['api:get-dashboard-export'] },
  { id: 'wc-panel-empty', name: 'A panel with no rows says so instead of drawing an empty chart', area: 'Dashboards', flow: 'Empty panel', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'navigate /d/rev-by-store?store=none', expected: 'the panel reads "No rows for this filter"', actual: 'the panel reads "No rows for this filter"', milestone: 'An empty result is explained', claim: 'A panel with no rows states it rather than rendering blank axes.', specRef: 'docs/console/dashboards.md#empty', interfacesUsed: ['web:open-dashboard'] },
  { id: 'wc-role-viewer', name: 'A viewer cannot open the members page', area: 'Access', flow: 'Role enforcement', status: 'passing', drivers: ['web', 'api'], driver: 'api', invocation: 'GET /api/members  (as a viewer)', expected: '403 Forbidden', actual: '403 Forbidden', milestone: 'A viewer sees nothing administrative', claim: 'Only an admin can read the member list.', specRef: 'docs/console/roles.md#viewer', interfacesUsed: ['api:get-members'] },
  { id: 'wc-invite-expiry', name: 'An invitation expires after seven days', area: 'Access', flow: 'Invite a member', status: 'failing', drivers: ['api'], driver: 'api', invocation: 'POST /api/invitations/inv_2210/accept  (8 days later)', expected: '410 Gone, body.code is "invitation_expired"', actual: '200 OK, the member is created', milestone: 'A stale invitation cannot be redeemed', claim: 'An invitation older than seven days cannot be accepted.', specRef: 'docs/console/roles.md#invitations', interfacesUsed: ['api:post-invitation-accept'] },
  { id: 'wc-last-admin', name: 'Removing the last admin is refused', area: 'Access', flow: 'Remove a member', status: 'passing', drivers: ['api'], driver: 'api', invocation: 'DELETE /api/members/m1', expected: '409 Conflict, body.code is "last_admin"', actual: '409 Conflict, body.code is "last_admin"', milestone: 'A workspace always has an admin', claim: 'The last admin of a workspace cannot be removed.', specRef: 'docs/console/roles.md#last-admin', interfacesUsed: ['api:delete-member'] },
  { id: 'wc-theme-persist', name: 'The chosen theme survives a sign out', area: 'Sessions', flow: 'Appearance', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'choose the dark theme\nsign out\nsign in again', expected: 'the console is still dark', actual: 'the console is still dark', milestone: 'A preference belongs to the account', claim: 'The theme preference is stored on the account, not the browser.', specRef: 'docs/console/preferences.md#theme', interfacesUsed: ['web:preferences'] },
  { id: 'wc-audit-log', name: 'Every role change appears in the audit log', area: 'Access', flow: 'Audit log', status: 'passing', drivers: ['api'], driver: 'api', invocation: 'PATCH /api/members/m3 { "role": "admin" }\nGET /api/audit?limit=1', expected: 'the newest entry names the actor, the target and both roles', actual: 'the newest entry names the actor, the target and both roles', milestone: 'A privilege change is never silent', claim: 'A role change writes an audit entry naming the actor and both roles.', specRef: 'docs/console/audit.md#roles', interfacesUsed: ['api:get-audit'] },
  { id: 'wc-slow-panel', name: 'A panel slower than 5 seconds shows a stale stamp', area: 'Dashboards', flow: 'Slow panel', status: 'blocked', drivers: ['web'], driver: 'web', invocation: 'navigate /d/warehouse-latency', expected: 'the panel carries a "data from 5 minutes ago" stamp', actual: 'not reached, the run stopped before this step', milestone: 'Slow data says how old it is', claim: 'A panel served from cache shows the age of its data.', specRef: 'docs/console/dashboards.md#staleness', interfacesUsed: ['web:open-dashboard'], reason: 'The warehouse replica is a supplied dependency with no values stored.' },
  { id: 'wc-keyboard-nav', name: 'The command palette opens on the keyboard alone', area: 'Sessions', flow: 'Command palette', status: 'passing', drivers: ['web'], driver: 'web', invocation: 'press Control+K', expected: 'the palette takes focus', actual: 'the palette takes focus', milestone: 'The console is reachable without a mouse', claim: 'The command palette opens with Control+K on every page.', specRef: 'docs/console/keyboard.md#palette', interfacesUsed: ['web:command-palette'] },
  { id: 'wc-csv-bom', name: 'An export opens correctly in Excel', area: 'Dashboards', flow: 'Export a dashboard', status: 'not-testable', drivers: ['api'], driver: 'api', invocation: 'GET /api/dashboards/rev-by-store/export?format=csv', expected: 'Excel renders the accented店 names correctly', actual: 'no interface reports how a third-party spreadsheet renders the file', milestone: 'An export is readable where it is used', claim: 'A CSV export opens correctly in Excel with non-ASCII names.', specRef: 'docs/console/dashboards.md#export', interfacesUsed: ['api:get-dashboard-export'] },
  { id: 'wc-new-panel-type', name: 'A funnel panel renders its drop-off steps', area: 'Dashboards', flow: 'Funnel panel', status: 'never-run', drivers: ['web'], driver: 'web', invocation: 'navigate /d/checkout-funnel', expected: 'five steps with a drop-off percentage each', actual: 'not run yet', milestone: 'A funnel reads as a funnel', claim: 'A funnel panel shows each step and its drop-off.', specRef: 'docs/console/dashboards.md#funnel', interfacesUsed: ['web:open-dashboard'] },
];

const WC_TESTS = WC_SEEDS.map((s) =>
  mk(s, s.status === 'never-run' || s.status === 'not-testable' ? null : WC_RUN),
);

const WC_FAILED = ['wc-signout-everywhere', 'wc-invite-expiry'];
const WC_BLOCKED = ['wc-slow-panel'];

const WC_RUNS: Run[] = [
  mkRun(WC_TESTS, { id: 'run-wc-9d20b41', repoId: 'web-console', sha: '9d20b41', branch: 'main', origin: 'hosted', at: '2 days ago', verdict: 'failure', duration: '4m 03s' }, WC_FAILED, WC_BLOCKED),
  mkRun(WC_TESTS, { id: 'run-wc-118-hosted', repoId: 'web-console', prNumber: 118, sha: '2f9ac30', branch: 'feat/funnel-panel', origin: 'hosted', at: '3 days ago', verdict: 'failure', duration: '3m 51s' }, WC_FAILED, WC_BLOCKED),
  mkRun(WC_TESTS, { id: 'run-wc-116-local', repoId: 'web-console', prNumber: 116, sha: 'b3a70de', branch: 'fix/session-revoke', origin: 'local', at: '4 days ago', verdict: 'failure', duration: '5m 22s', local: { user: 'priya', os: 'Windows 11 x64', dirtyTree: false, ranInCi: false } }, WC_FAILED, WC_BLOCKED),
  mkRun(WC_TESTS, { id: 'run-wc-2c1', repoId: 'web-console', sha: '2c1b9f8', branch: 'main', origin: 'hosted', at: '6 days ago', verdict: 'failure', duration: '3m 44s' }, ['wc-signout-everywhere'], WC_BLOCKED),
  mkRun(WC_TESTS, { id: 'run-wc-113-hosted', repoId: 'web-console', prNumber: 113, sha: '7710c4a', branch: 'chore/tailwind-4', origin: 'hosted', at: '8 days ago', verdict: 'success', duration: '3m 30s' }, [], WC_BLOCKED),
  mkRun(WC_TESTS, { id: 'run-wc-0a4', repoId: 'web-console', sha: '0a4d992', branch: 'main', origin: 'hosted', at: '9 days ago', verdict: 'success', duration: '3m 28s' }, [], WC_BLOCKED),
];

const WC_INTERFACES: GuardInterface[] = [
  { id: 'web:sign-in', surface: 'web', family: 'sessions', kind: 'task', fingerprint: '11ba07', origin: 'authored', summary: 'Sign in with a one-time code.', web: { place: 'Sign in', address: '/sign-in', steps: [{ order: 1, action: 'navigate', target: '/sign-in' }, { order: 2, action: 'type', target: 'the one-time code' }, { order: 3, action: 'click', target: 'Continue' }], endsIn: 'signed-in' } },
  { id: 'web:security-page', surface: 'web', family: 'sessions', kind: 'task', fingerprint: '9c4e21', origin: 'authored', summary: 'Open the security settings and revoke sessions.', web: { place: 'Security settings', address: '/settings/security', steps: [{ order: 1, action: 'navigate', target: '/settings/security' }, { order: 2, action: 'click', target: 'Sign out everywhere' }], endsIn: 'sessions-revoked' } },
  { id: 'web:preferences', surface: 'web', family: 'sessions', kind: 'task', fingerprint: '3a70bd', origin: 'authored', summary: 'Change the appearance preferences.', web: { place: 'Preferences', address: '/settings/appearance', steps: [{ order: 1, action: 'navigate', target: '/settings/appearance' }, { order: 2, action: 'choose', target: 'Dark' }], endsIn: 'theme-dark' } },
  { id: 'web:command-palette', surface: 'web', family: 'sessions', kind: 'task', fingerprint: 'd10f55', origin: 'authored', summary: 'Open the command palette from the keyboard.', web: { place: 'Any page', address: '/*', steps: [{ order: 1, action: 'press', target: 'Control+K' }], endsIn: 'palette-open' } },
  { id: 'web:open-dashboard', surface: 'web', family: 'dashboards', kind: 'task', fingerprint: '68cc12', origin: 'authored', summary: 'Open a dashboard and filter it.', web: { place: 'Dashboard', address: '/d/:slug', steps: [{ order: 1, action: 'navigate', target: '/d/rev-by-store' }, { order: 2, action: 'choose', target: 'a store' }], endsIn: 'dashboard-filtered' } },
  { id: 'web:open-shared-dashboard', surface: 'web', family: 'dashboards', kind: 'task', fingerprint: '4471ea', origin: 'authored', summary: 'Open a dashboard through a share token.', web: { place: 'Dashboard', address: '/d/:slug', steps: [{ order: 1, action: 'navigate', target: '/d/rev-by-store?token=shr_71ac' }], endsIn: 'dashboard-readonly' } },
  { id: 'api:get-dashboard-export', surface: 'api', family: 'dashboards', kind: 'operation', fingerprint: 'ff0a31', origin: 'derived', summary: 'Export every panel of a dashboard.', api: { method: 'GET', path: '/api/dashboards/{slug}/export', request: [{ name: 'slug', type: 'path', required: true, about: 'The dashboard.' }, { name: 'format', type: 'query', required: true, about: 'csv or xlsx.' }], response: [{ name: 'body', type: 'binary', required: true, about: 'A zip with one file per panel.' }] } },
  { id: 'api:get-members', surface: 'api', family: 'access', kind: 'operation', fingerprint: '2b8d40', origin: 'derived', summary: 'List the workspace members.', api: { method: 'GET', path: '/api/members', request: [], response: [{ name: 'data[]', type: 'array', required: true, about: 'Members with their roles.' }] } },
  { id: 'api:delete-member', surface: 'api', family: 'access', kind: 'operation', fingerprint: '77e1c9', origin: 'derived', summary: 'Remove a member.', api: { method: 'DELETE', path: '/api/members/{id}', request: [{ name: 'id', type: 'path', required: true, about: 'The member to remove.' }], response: [{ name: 'code', type: 'string', required: false, about: 'last_admin when refused.' }] } },
  { id: 'api:post-invitation-accept', surface: 'api', family: 'access', kind: 'operation', fingerprint: '5510ab', origin: 'derived', summary: 'Accept an invitation.', api: { method: 'POST', path: '/api/invitations/{id}/accept', request: [{ name: 'id', type: 'path', required: true, about: 'The invitation.' }], response: [{ name: 'code', type: 'string', required: false, about: 'invitation_expired when refused.' }] } },
  { id: 'api:delete-sessions', surface: 'api', family: 'sessions', kind: 'operation', fingerprint: '90b7d2', origin: 'derived', summary: 'Revoke every session of the signed-in user.', api: { method: 'DELETE', path: '/api/sessions', request: [], response: [{ name: 'revoked', type: 'integer', required: true, about: 'Sessions ended.' }] } },
  { id: 'api:get-audit', surface: 'api', family: 'access', kind: 'operation', fingerprint: 'c02f18', origin: 'derived', summary: 'Read the audit log.', api: { method: 'GET', path: '/api/audit', request: [{ name: 'limit', type: 'query', required: false, about: 'Page size.' }], response: [{ name: 'data[]', type: 'array', required: true, about: 'Entries, newest first.' }] } },
];

const WC_RECIPES: SurfaceRecipe[] = [
  { surface: 'api', label: 'Preparation: build, migrate, serve', steps: ['pnpm install --frozen-lockfile', 'pnpm build', 'pnpm migrate', 'pnpm start --port 3010'] },
  { surface: 'web', label: 'Preparation: build, serve, sign in', steps: ['pnpm build', 'pnpm preview --port 4173', 'sign in as dana@acme.dev'] },
];

const WC_SOURCES: DocSource[] = [
  {
    id: 'base-ui',
    title: 'Base UI documentation',
    llmsTxtUrl: 'https://base-ui.com/llms.txt',
    fetchedAt: '11 days ago',
    pages: [
      { id: 'base-ui-dialog', title: 'Dialog', url: 'https://base-ui.com/react/components/dialog', fetchedAt: '11 days ago', body: '# Dialog\n\nA dialog traps focus while it is open and returns focus to the trigger when it closes. Every dialog needs an accessible name.' },
      { id: 'base-ui-popover', title: 'Popover', url: 'https://base-ui.com/react/components/popover', fetchedAt: '11 days ago', body: '# Popover\n\nA popover is anchored to a trigger and closes on outside press or Escape.' },
      { id: 'base-ui-select', title: 'Select', url: 'https://base-ui.com/react/components/select', fetchedAt: '11 days ago', body: '# Select\n\nThe select renders a listbox. Typeahead selects the first option whose label starts with the typed characters.' },
    ],
  },
];

const WC_DEPENDENCIES: Dependency[] = [
  { id: 'wc-dep-dashboard', name: 'A dashboard', klass: 'step-creatable', service: 'web-console', envVars: [], evidence: ['POST /api/dashboards in the route table'], about: 'A step creates it, so no fixture and no seed are needed.' },
  { id: 'wc-dep-invitation', name: 'An invitation', klass: 'step-creatable', service: 'web-console', envVars: [], evidence: ['POST /api/invitations in the route table'], about: 'A step creates it, so no fixture and no seed are needed.' },
  { id: 'wc-dep-member', name: 'A member with the viewer role', klass: 'seedable', service: 'postgres', envVars: ['DATABASE_URL'], evidence: ['table `members` in migrations/0002_members.sql', 'seed script db/seed/members.ts'], about: 'No interface creates one, but the seed script does.' },
  { id: 'wc-dep-panels', name: 'Panel fixtures', klass: 'seedable', service: 'postgres', envVars: ['DATABASE_URL'], evidence: ['seed script db/seed/panels.ts'], about: 'No interface creates one, but the seed script does.' },
  { id: 'wc-dep-warehouse', name: 'Warehouse replica', klass: 'supplied', service: 'snowflake', envVars: ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_TOKEN'], evidence: ['import of snowflake-sdk in packages/warehouse/src/client.ts'], about: 'A real external account. One scenario is blocked until it has values.' },
  { id: 'wc-dep-sentry', name: 'Sentry project', klass: 'supplied', service: 'sentry', envVars: ['SENTRY_DSN'], evidence: ['SENTRY_DSN read in src/observability.ts'], about: 'A real external account.', storedHint: 'saved ••••9f10' },
];

const WEB_CONSOLE: RepoGuardData = {
  areas: ['Sessions', 'Dashboards', 'Access'],
  tests: WC_TESTS,
  interfaces: WC_INTERFACES,
  recipes: WC_RECIPES,
  runs: WC_RUNS,
  sources: WC_SOURCES,
  dependencies: WC_DEPENDENCIES,
  coverage: coverage(
    WC_TESTS,
    [61, 8, 14],
    [304, 22, 51],
    [22, 3, 1],
    [0, 6, 6],
    [
      { label: 'Corpus scanned', value: '2 days ago on 9d20b41' },
      { label: 'Scenarios generated', value: '2 days ago on 9d20b41' },
      { label: 'Interfaces derived', value: '2 days ago on 9d20b41' },
      { label: 'Last hosted run', value: '2 days ago on 9d20b41' },
      { label: 'Last local run', value: '4 days ago on b3a70de by priya' },
    ],
  ),
};

// --- acme/billing (mid-onboarding) ------------------------------------------

const BILL_SEEDS: TestSeed[] = [
  { id: 'bl-invoice-round', name: 'An invoice line rounds to the currency minor unit', area: 'Invoices', flow: 'Issue an invoice', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'POST /billing/invoices { "lines": [{ "amount": 1999.5 }] }', expected: '201 Created, the line reads 2000', actual: 'not run yet', milestone: 'Money is never fractional', claim: 'An invoice line is rounded half up to the currency minor unit.', specRef: 'docs/billing/invoices.md#rounding', interfacesUsed: ['api:post-invoice'] },
  { id: 'bl-invoice-void', name: 'Voiding a paid invoice is refused', area: 'Invoices', flow: 'Void an invoice', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'POST /billing/invoices/inv_88/void', expected: '409 Conflict, body.code is "already_paid"', actual: 'not run yet', milestone: 'A paid invoice stays on the books', claim: 'A paid invoice cannot be voided.', specRef: 'docs/billing/invoices.md#void', interfacesUsed: ['api:post-invoice-void'] },
  { id: 'bl-invoice-pdf', name: 'An invoice PDF names the billing entity', area: 'Invoices', flow: 'Invoice PDF', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'GET /billing/invoices/inv_88.pdf', expected: 'the PDF header names Acme Payments Ltd', actual: 'not run yet', milestone: 'A document says who issued it', claim: 'An invoice PDF carries the legal billing entity of the workspace.', specRef: 'docs/billing/invoices.md#pdf', interfacesUsed: ['api:get-invoice-pdf'] },
  { id: 'bl-sub-proration', name: 'Upgrading mid-cycle prorates the difference', area: 'Subscriptions', flow: 'Change a plan', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'PATCH /billing/subscriptions/sub_12 { "plan": "team" }', expected: '200 OK, a prorated line for the remaining days', actual: 'not run yet', milestone: 'An upgrade charges only the remainder', claim: 'A mid-cycle plan change prorates by remaining days.', specRef: 'docs/billing/subscriptions.md#proration', interfacesUsed: ['api:patch-subscription'] },
  { id: 'bl-sub-cancel', name: 'Cancelling keeps the plan until the period ends', area: 'Subscriptions', flow: 'Cancel a plan', status: 'never-run', drivers: ['api', 'cli'], driver: 'cli', invocation: 'billing subscription cancel sub_12', expected: 'exit 0, status is "cancels_at_period_end"', actual: 'not run yet', milestone: 'A cancellation is not an immediate cut-off', claim: 'A cancelled subscription runs to the end of the paid period.', specRef: 'docs/billing/subscriptions.md#cancel', interfacesUsed: ['cli:billing-subscription'] },
  { id: 'bl-sub-dunning', name: 'A failed charge retries three times before suspension', area: 'Subscriptions', flow: 'Dunning', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'advance the clock through the retry schedule', expected: 'three retries, then status "suspended"', actual: 'not run yet', milestone: 'A card failure is not an instant cut-off', claim: 'A failed renewal is retried three times over seven days before suspension.', specRef: 'docs/billing/subscriptions.md#dunning', interfacesUsed: ['api:patch-subscription'] },
  { id: 'bl-tax-reverse-charge', name: 'A VAT-registered EU buyer is reverse charged', area: 'Taxes', flow: 'Tax calculation', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'POST /billing/invoices { "vatNumber": "DE811907980" }', expected: '201 Created, tax is 0 and the note reads "reverse charge"', actual: 'not run yet', milestone: 'A valid VAT number moves the tax', claim: 'A validated EU VAT number outside the seller country is reverse charged.', specRef: 'docs/billing/taxes.md#reverse-charge', interfacesUsed: ['api:post-invoice'] },
  { id: 'bl-tax-invalid-vat', name: 'An invalid VAT number is charged tax', area: 'Taxes', flow: 'Tax calculation', status: 'never-run', drivers: ['api'], driver: 'api', invocation: 'POST /billing/invoices { "vatNumber": "DE000000000" }', expected: '201 Created, tax is charged at the buyer rate', actual: 'not run yet', milestone: 'An unverifiable number is not a discount', claim: 'A VAT number that fails validation does not remove tax.', specRef: 'docs/billing/taxes.md#validation', interfacesUsed: ['api:post-invoice'] },
];

const BILL_TESTS = BILL_SEEDS.map((s) => mk(s, null));

const BILL_INTERFACES: GuardInterface[] = [
  { id: 'api:post-invoice', surface: 'api', family: 'invoices', kind: 'operation', fingerprint: 'aa30d1', origin: 'derived', summary: 'Issue an invoice.', api: { method: 'POST', path: '/billing/invoices', request: [{ name: 'customer', type: 'string', required: true, about: 'The billed account.' }, { name: 'lines[]', type: 'array', required: true, about: 'Description and amount.' }, { name: 'vatNumber', type: 'string', required: false, about: 'Validated against VIES.' }], response: [{ name: 'id', type: 'string', required: true, about: 'The invoice id.' }, { name: 'tax', type: 'integer', required: true, about: 'Tax in minor units.' }] } },
  { id: 'api:post-invoice-void', surface: 'api', family: 'invoices', kind: 'operation', fingerprint: '4bb712', origin: 'derived', summary: 'Void an unpaid invoice.', api: { method: 'POST', path: '/billing/invoices/{id}/void', request: [{ name: 'id', type: 'path', required: true, about: 'The invoice.' }], response: [{ name: 'code', type: 'string', required: false, about: 'already_paid when refused.' }] } },
  { id: 'api:get-invoice-pdf', surface: 'api', family: 'invoices', kind: 'operation', fingerprint: '7fa028', origin: 'derived', summary: 'Render an invoice as a PDF.', api: { method: 'GET', path: '/billing/invoices/{id}.pdf', request: [{ name: 'id', type: 'path', required: true, about: 'The invoice.' }], response: [{ name: 'body', type: 'binary', required: true, about: 'A PDF document.' }] } },
  { id: 'api:patch-subscription', surface: 'api', family: 'subscriptions', kind: 'operation', fingerprint: 'd91c46', origin: 'derived', summary: 'Change or cancel a subscription.', api: { method: 'PATCH', path: '/billing/subscriptions/{id}', request: [{ name: 'plan', type: 'string', required: false, about: 'The new plan.' }, { name: 'cancel', type: 'boolean', required: false, about: 'Cancel at period end.' }], response: [{ name: 'status', type: 'string', required: true, about: 'active, cancels_at_period_end or suspended.' }] } },
  { id: 'cli:billing-subscription', surface: 'cli', family: 'subscriptions', kind: 'command group', fingerprint: '2e6604', origin: 'derived', summary: 'Inspect and change subscriptions.', cli: { command: 'billing subscription <show|cancel|change>', flags: [{ name: '<id>', required: true, about: 'The subscription.' }, { name: '--plan', required: false, choices: ['free', 'team', 'enterprise'], about: 'The plan to move to.' }], consumes: ['A subscription'], produces: ['The subscription status on stdout'] } },
  { id: 'cli:billing-invoice', surface: 'cli', family: 'invoices', kind: 'command group', fingerprint: '6d0a83', origin: 'derived', summary: 'Issue and void invoices.', cli: { command: 'billing invoice <issue|void|show>', flags: [{ name: '--customer', required: false, about: 'The billed account.' }, { name: '--json', required: false, about: 'Machine-readable output.' }], consumes: ['A customer account'], produces: ['An invoice id on stdout'] } },
];

const BILLING: RepoGuardData = {
  areas: ['Invoices', 'Subscriptions', 'Taxes'],
  tests: BILL_TESTS,
  interfaces: BILL_INTERFACES,
  recipes: [
    { surface: 'api', label: 'Preparation: build, migrate, serve', steps: ['pnpm install --frozen-lockfile', 'pnpm build', 'pnpm migrate', 'pnpm start --port 5010'] },
    { surface: 'cli', label: 'Preparation: build, install, authenticate', steps: ['pnpm build', 'npm link ./packages/billing-cli', 'billing auth login --token $BILLING_TEST_TOKEN'] },
  ],
  runs: [],
  sources: [
    {
      id: 'vies',
      title: 'EU VIES VAT guidance',
      llmsTxtUrl: 'https://taxation-customs.ec.europa.eu/llms.txt',
      fetchedAt: '40 minutes ago',
      pages: [
        { id: 'vies-validation', title: 'VAT number validation', url: 'https://taxation-customs.ec.europa.eu/vies', fetchedAt: '40 minutes ago', body: '# VAT number validation\n\nThe VIES service confirms whether a VAT number is valid for cross-border trade. A number that cannot be confirmed must be treated as invalid, and tax charged as normal.' },
        { id: 'vies-reverse-charge', title: 'Reverse charge', url: 'https://taxation-customs.ec.europa.eu/reverse-charge', fetchedAt: '40 minutes ago', body: '# Reverse charge\n\nWhere the buyer is VAT registered in another member state, the seller does not charge VAT and the buyer accounts for it. The invoice must carry the words "reverse charge".' },
        { id: 'vies-rates', title: 'Standard rates', url: 'https://taxation-customs.ec.europa.eu/rates', fetchedAt: '40 minutes ago', body: '# Standard rates\n\nEach member state sets its own standard rate. Rates change on the first day of a quarter at the earliest.' },
      ],
    },
  ],
  dependencies: [
    { id: 'bl-dep-invoice', name: 'An invoice', klass: 'step-creatable', service: 'billing', envVars: [], evidence: ['POST /billing/invoices in the route table'], about: 'A step creates it, so no fixture and no seed are needed.' },
    { id: 'bl-dep-subscription', name: 'A subscription', klass: 'step-creatable', service: 'billing', envVars: [], evidence: ['POST /billing/subscriptions in the route table'], about: 'A step creates it, so no fixture and no seed are needed.' },
    { id: 'bl-dep-account', name: 'A billed account', klass: 'seedable', service: 'postgres', envVars: ['DATABASE_URL'], evidence: ['table `accounts` in migrations/0001_accounts.sql', 'seed script db/seed/accounts.ts'], about: 'No interface creates one, but the seed script does.' },
    { id: 'bl-dep-rates', name: 'Tax rate table', klass: 'seedable', service: 'postgres', envVars: ['DATABASE_URL'], evidence: ['seed script db/seed/tax-rates.ts'], about: 'No interface creates one, but the seed script does.' },
    { id: 'bl-dep-vies', name: 'VIES VAT lookup', klass: 'supplied', service: 'vies', envVars: ['VIES_ENDPOINT'], evidence: ['import of soap in packages/tax/src/vies.ts'], about: 'A real external service. Nothing in the repo can create one.' },
    { id: 'bl-dep-stripe-billing', name: 'Stripe billing account', klass: 'supplied', service: 'stripe', envVars: ['STRIPE_SECRET_KEY'], evidence: ['import of stripe in packages/billing/src/gateway.ts'], about: 'A real external account. Nothing in the repo can create one.' },
  ],
  coverage: coverage(
    BILL_TESTS,
    [12, 4, 41],
    [88, 0, 190],
    [12, 0, 0],
    [2, 4, 0],
    [
      { label: 'Corpus scanned', value: '40 minutes ago on 6c02da9' },
      { label: 'Scenarios generated', value: 'in flight, 12 of 31 flows' },
      { label: 'Interfaces derived', value: '38 minutes ago on 6c02da9' },
      { label: 'Last hosted run', value: 'no run yet' },
      { label: 'Last local run', value: 'no run yet' },
    ],
  ),
};

// --- platform/devops-tools ---------------------------------------------------

const DT_RUN = { origin: 'hosted' as const, sha: '4b1e77c', at: 'Yesterday', runId: 'run-dt-4b1e77c' };

const DT_SEEDS: TestSeed[] = [
  { id: 'dt-pipeline-lint', name: 'A pipeline with an unknown task fails linting', area: 'Pipelines', flow: 'Lint a pipeline', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline lint ./pipelines/build.yaml', expected: 'exit 1, stderr names the unknown task', actual: 'exit 1, stderr names the unknown task', milestone: 'A typo is caught before the run', claim: 'Linting fails on a task name the catalog does not know.', specRef: 'docs/devops/pipelines.md#lint', interfacesUsed: ['cli:pipeline-lint'] },
  { id: 'dt-pipeline-plan', name: 'Plan prints the stages in dependency order', area: 'Pipelines', flow: 'Plan a pipeline', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline plan ./pipelines/build.yaml', expected: 'build precedes test, test precedes deploy', actual: 'build precedes test, test precedes deploy', milestone: 'The order is knowable without running', claim: 'Plan prints stages in topological order.', specRef: 'docs/devops/pipelines.md#plan', interfacesUsed: ['cli:pipeline-plan'] },
  { id: 'dt-pipeline-cycle', name: 'A cyclic pipeline is refused', area: 'Pipelines', flow: 'Plan a pipeline', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline plan ./pipelines/cyclic.yaml', expected: 'exit 1, stderr names both stages of the cycle', actual: 'exit 1, stderr names both stages of the cycle', milestone: 'A cycle is named, not hung on', claim: 'A dependency cycle is refused and both stages are named.', specRef: 'docs/devops/pipelines.md#cycles', interfacesUsed: ['cli:pipeline-plan'] },
  { id: 'dt-pipeline-retry', name: 'A failed stage retries with backoff', area: 'Pipelines', flow: 'Run a pipeline', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline run ./pipelines/flaky.yaml --retries 2', expected: 'three attempts with growing gaps, then exit 1', actual: 'three attempts with growing gaps, then exit 1', milestone: 'A flaky stage is retried, not hidden', claim: 'A failing stage is retried with exponential backoff up to the retry count.', specRef: 'docs/devops/pipelines.md#retries', interfacesUsed: ['cli:pipeline-run'] },
  { id: 'dt-secret-mask', name: 'A secret never reaches the log', area: 'Secrets', flow: 'Run with secrets', status: 'failing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline run ./pipelines/deploy.yaml --secret API_TOKEN=abc123', expected: 'the log shows ****** wherever the value appears', actual: 'the log shows abc123 in the curl trace of the deploy stage', milestone: 'A secret is masked in every stream', claim: 'A secret value is masked in stdout, stderr and the uploaded log.', specRef: 'docs/devops/secrets.md#masking', interfacesUsed: ['cli:pipeline-run'] },
  { id: 'dt-secret-rotate', name: 'Rotating a secret keeps the old value readable for an hour', area: 'Secrets', flow: 'Rotate a secret', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops secret rotate API_TOKEN', expected: 'both values resolve for 60 minutes', actual: 'both values resolve for 60 minutes', milestone: 'A rotation does not break a running deploy', claim: 'A rotated secret keeps its previous value valid for one hour.', specRef: 'docs/devops/secrets.md#rotation', interfacesUsed: ['cli:secret-rotate'] },
  { id: 'dt-secret-scope', name: 'A secret scoped to staging is absent in production', area: 'Secrets', flow: 'Scope a secret', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops secret get API_TOKEN --env production', expected: 'exit 1, stderr says the secret is not defined here', actual: 'exit 1, stderr says the secret is not defined here', milestone: 'A scope is enforced, not advisory', claim: 'A secret is readable only in the environments it is scoped to.', specRef: 'docs/devops/secrets.md#scopes', interfacesUsed: ['cli:secret-get'] },
  { id: 'dt-env-promote', name: 'Promoting an environment copies only the approved build', area: 'Environments', flow: 'Promote a build', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops env promote staging production --build 5512', expected: 'exit 0, production points at build 5512', actual: 'exit 0, production points at build 5512', milestone: 'A promotion moves an artifact, not a branch', claim: 'Promotion moves the named build and nothing else.', specRef: 'docs/devops/environments.md#promote', interfacesUsed: ['cli:env-promote'] },
  { id: 'dt-env-unapproved', name: 'Promoting an unapproved build is refused', area: 'Environments', flow: 'Promote a build', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops env promote staging production --build 5599', expected: 'exit 1, stderr says the build is not approved', actual: 'exit 1, stderr says the build is not approved', milestone: 'Approval gates the promotion', claim: 'Only an approved build can be promoted to production.', specRef: 'docs/devops/environments.md#approval', interfacesUsed: ['cli:env-promote'] },
  { id: 'dt-env-lock', name: 'A locked environment refuses a deploy', area: 'Environments', flow: 'Lock an environment', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops env lock production --reason "incident 4412"\ndevops env deploy production --build 5512', expected: 'the deploy exits 1 and quotes the lock reason', actual: 'the deploy exits 1 and quotes the lock reason', milestone: 'A lock is visible in the refusal', claim: 'A deploy to a locked environment is refused and the lock reason is shown.', specRef: 'docs/devops/environments.md#locks', interfacesUsed: ['cli:env-lock'] },
  { id: 'dt-env-diff', name: 'Diff shows the variables that differ between environments', area: 'Environments', flow: 'Compare environments', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops env diff staging production', expected: 'only differing keys are listed, values masked', actual: 'only differing keys are listed, values masked', milestone: 'A drift is legible without exposing values', claim: 'An environment diff lists differing keys with masked values.', specRef: 'docs/devops/environments.md#diff', interfacesUsed: ['cli:env-diff'] },
  { id: 'dt-pipeline-cache', name: 'A cache hit skips the build stage', area: 'Pipelines', flow: 'Run a pipeline', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline run ./pipelines/build.yaml\ndevops pipeline run ./pipelines/build.yaml', expected: 'the second run reports the build stage as cached', actual: 'the second run reports the build stage as cached', milestone: 'An unchanged input is not rebuilt', claim: 'A stage whose inputs are unchanged is served from cache.', specRef: 'docs/devops/pipelines.md#cache', interfacesUsed: ['cli:pipeline-run'] },
  { id: 'dt-audit-deploy', name: 'Every deploy writes an audit entry', area: 'Environments', flow: 'Audit', status: 'blocked', drivers: ['cli'], driver: 'cli', invocation: 'devops audit list --env production --limit 1', expected: 'the newest entry names the actor and the build', actual: 'not reached, the run stopped before this step', milestone: 'A production change is attributable', claim: 'A deploy writes an audit entry naming the actor and the build.', specRef: 'docs/devops/environments.md#audit', interfacesUsed: ['cli:audit-list'], reason: 'The audit sink is a supplied dependency with no values stored.' },
  { id: 'dt-secret-import', name: 'Importing a dotenv file rejects duplicate keys', area: 'Secrets', flow: 'Import secrets', status: 'passing', drivers: ['cli'], driver: 'cli', invocation: 'devops secret import ./fixtures/dupes.env', expected: 'exit 2, stderr names the duplicated key and both lines', actual: 'exit 2, stderr names the duplicated key and both lines', milestone: 'An ambiguous import is refused', claim: 'An import with a duplicated key is refused and both lines are named.', specRef: 'docs/devops/secrets.md#import', interfacesUsed: ['cli:secret-import'] },
  { id: 'dt-pipeline-matrix', name: 'A matrix stage runs once per combination', area: 'Pipelines', flow: 'Matrix stages', status: 'never-run', drivers: ['cli'], driver: 'cli', invocation: 'devops pipeline run ./pipelines/matrix.yaml', expected: 'six runs, one per node and operating-system pair', actual: 'not run yet', milestone: 'A matrix is expanded, not collapsed', claim: 'A matrix stage runs once per combination of its axes.', specRef: 'docs/devops/pipelines.md#matrix', interfacesUsed: ['cli:pipeline-run'] },
];

const DT_TESTS = DT_SEEDS.map((s) => mk(s, s.status === 'never-run' ? null : DT_RUN));
const DT_FAILED = ['dt-secret-mask'];
const DT_BLOCKED = ['dt-audit-deploy'];

const DT_RUNS: Run[] = [
  mkRun(DT_TESTS, { id: 'run-dt-4b1e77c', repoId: 'devops-tools', sha: '4b1e77c', branch: 'main', origin: 'hosted', at: 'Yesterday', verdict: 'failure', duration: '1m 52s' }, DT_FAILED, DT_BLOCKED),
  mkRun(DT_TESTS, { id: 'run-dt-95-hosted', repoId: 'devops-tools', prNumber: 95, sha: 'e30a1b7', branch: 'fix/secret-masking', origin: 'hosted', at: '2 days ago', verdict: 'failure', duration: '1m 47s' }, DT_FAILED, DT_BLOCKED),
  mkRun(DT_TESTS, { id: 'run-dt-95-local', repoId: 'devops-tools', prNumber: 95, sha: 'e30a1b7', branch: 'fix/secret-masking', origin: 'local', at: '2 days ago', verdict: 'failure', duration: '2m 12s', local: { user: 'mushegh', os: 'macOS 15.5 arm64', dirtyTree: false, ranInCi: false } }, DT_FAILED, DT_BLOCKED),
  mkRun(DT_TESTS, { id: 'run-dt-91-hosted', repoId: 'devops-tools', prNumber: 91, sha: '5c8bb02', branch: 'feat/env-diff', origin: 'hosted', at: '5 days ago', verdict: 'success', duration: '1m 41s' }, [], DT_BLOCKED),
  mkRun(DT_TESTS, { id: 'run-dt-9f2', repoId: 'devops-tools', sha: '9f22e50', branch: 'main', origin: 'hosted', at: '6 days ago', verdict: 'success', duration: '1m 38s' }, [], DT_BLOCKED),
  mkRun(DT_TESTS, { id: 'run-dt-88-local', repoId: 'devops-tools', prNumber: 88, sha: '77b1c93', branch: 'chore/dotnet-9', origin: 'local', at: '9 days ago', verdict: 'success', duration: '2m 04s', local: { user: 'dana', os: 'Ubuntu 24.04 x64', dirtyTree: true, ranInCi: true } }, [], DT_BLOCKED),
];

const DT_INTERFACES: GuardInterface[] = [
  { id: 'cli:pipeline-lint', surface: 'cli', family: 'pipeline', kind: 'command', fingerprint: '1a09fb', origin: 'derived', summary: 'Check a pipeline file against the task catalog.', cli: { command: 'devops pipeline lint', flags: [{ name: '<file>', required: true, about: 'The pipeline to check.' }, { name: '--strict', required: false, about: 'Treat warnings as errors.' }], consumes: ['A pipeline file'], produces: ['exit 0, or exit 1 with the offending task'] } },
  { id: 'cli:pipeline-plan', surface: 'cli', family: 'pipeline', kind: 'command', fingerprint: '5b2c77', origin: 'derived', summary: 'Print the stage order without running.', cli: { command: 'devops pipeline plan', flags: [{ name: '<file>', required: true, about: 'The pipeline to plan.' }, { name: '--json', required: false, about: 'Machine-readable output.' }], consumes: ['A pipeline file'], produces: ['The stages in topological order'] } },
  { id: 'cli:pipeline-run', surface: 'cli', family: 'pipeline', kind: 'command', fingerprint: 'c710e3', origin: 'derived', summary: 'Run a pipeline locally.', cli: { command: 'devops pipeline run', flags: [{ name: '<file>', required: true, about: 'The pipeline to run.' }, { name: '--retries', required: false, about: 'Retries per failing stage.' }, { name: '--secret', required: false, about: 'KEY=VALUE, repeatable.' }], consumes: ['A pipeline file', 'The secrets it names'], produces: ['A run log and an exit code'] } },
  { id: 'cli:secret-rotate', surface: 'cli', family: 'secret', kind: 'command', fingerprint: '8e11ad', origin: 'derived', summary: 'Rotate a secret, keeping the old value briefly.', cli: { command: 'devops secret rotate', flags: [{ name: '<key>', required: true, about: 'The secret to rotate.' }, { name: '--grace', required: false, about: 'Minutes the old value stays valid.' }], consumes: ['An existing secret'], produces: ['A new value, and the old one valid for the grace period'] } },
  { id: 'cli:secret-get', surface: 'cli', family: 'secret', kind: 'command', fingerprint: '0d4f92', origin: 'derived', summary: 'Read a secret in one environment.', cli: { command: 'devops secret get', flags: [{ name: '<key>', required: true, about: 'The secret to read.' }, { name: '--env', required: true, choices: ['development', 'staging', 'production'], about: 'Which environment.' }], consumes: ['A secret scoped to that environment'], produces: ['The value on stdout, or exit 1'] } },
  { id: 'cli:secret-import', surface: 'cli', family: 'secret', kind: 'command', fingerprint: 'b6205c', origin: 'derived', summary: 'Import secrets from a dotenv file.', cli: { command: 'devops secret import', flags: [{ name: '<file>', required: true, about: 'A dotenv file.' }, { name: '--env', required: false, about: 'Target environment.' }], consumes: ['A dotenv file'], produces: ['One secret per line, or exit 2 on a duplicate'] } },
  { id: 'cli:env-promote', surface: 'cli', family: 'environment', kind: 'command', fingerprint: '3c9910', origin: 'derived', summary: 'Promote a build between environments.', cli: { command: 'devops env promote', flags: [{ name: '<from>', required: true, about: 'Source environment.' }, { name: '<to>', required: true, about: 'Target environment.' }, { name: '--build', required: true, about: 'The build number to move.' }], consumes: ['An approved build'], produces: ['The target pointing at that build'] } },
  { id: 'cli:env-lock', surface: 'cli', family: 'environment', kind: 'command', fingerprint: 'e44a01', origin: 'derived', summary: 'Lock an environment against deploys.', cli: { command: 'devops env lock', flags: [{ name: '<env>', required: true, about: 'The environment to lock.' }, { name: '--reason', required: true, about: 'Quoted back in every refusal.' }], consumes: [], produces: ['A lock that refuses deploys'] } },
  { id: 'cli:env-diff', surface: 'cli', family: 'environment', kind: 'command', fingerprint: '77c5de', origin: 'derived', summary: 'Compare two environments.', cli: { command: 'devops env diff', flags: [{ name: '<a>', required: true, about: 'First environment.' }, { name: '<b>', required: true, about: 'Second environment.' }], consumes: [], produces: ['The differing keys, values masked'] } },
  { id: 'cli:audit-list', surface: 'cli', family: 'environment', kind: 'command', fingerprint: '20fe6b', origin: 'derived', summary: 'Read the deploy audit log.', cli: { command: 'devops audit list', flags: [{ name: '--env', required: false, about: 'Filter by environment.' }, { name: '--limit', required: false, about: 'How many entries.' }], consumes: ['An audit sink'], produces: ['Entries, newest first'] } },
];

const DEVOPS_TOOLS: RepoGuardData = {
  areas: ['Pipelines', 'Secrets', 'Environments'],
  tests: DT_TESTS,
  interfaces: DT_INTERFACES,
  recipes: [
    { surface: 'cli', label: 'Preparation: build, install, authenticate', steps: ['dotnet build -c Release', 'ln -s ./bin/Release/devops /usr/local/bin/devops', 'devops auth login --pat $AZDO_PAT'] },
  ],
  runs: DT_RUNS,
  sources: [
    {
      id: 'azure-pipelines',
      title: 'Azure Pipelines reference',
      llmsTxtUrl: 'https://learn.microsoft.com/azure/devops/llms.txt',
      fetchedAt: '3 days ago',
      pages: [
        { id: 'azp-yaml', title: 'YAML schema', url: 'https://learn.microsoft.com/azure/devops/pipelines/yaml-schema', fetchedAt: '3 days ago', body: '# YAML schema\n\nA pipeline is stages, jobs and steps. A stage depends on other stages through dependsOn, and the graph must be acyclic.' },
        { id: 'azp-variables', title: 'Variables and secrets', url: 'https://learn.microsoft.com/azure/devops/pipelines/variables', fetchedAt: '3 days ago', body: '# Variables and secrets\n\nSecret variables are masked in the log. Masking is a best effort: a secret that is transformed, encoded or split across lines may still appear.' },
        { id: 'azp-environments', title: 'Environments', url: 'https://learn.microsoft.com/azure/devops/pipelines/environments', fetchedAt: '3 days ago', body: '# Environments\n\nAn environment groups the resources a deployment targets and carries its approval checks and its deployment history.' },
        { id: 'azp-caching', title: 'Caching', url: 'https://learn.microsoft.com/azure/devops/pipelines/caching', fetchedAt: '3 days ago', body: '# Caching\n\nA cache is keyed on a set of inputs. A key that does not change restores the cache and the step can be skipped.' },
      ],
    },
  ],
  dependencies: [
    { id: 'dt-dep-pipeline', name: 'A pipeline file', klass: 'step-creatable', service: 'devops-tools', envVars: [], evidence: ['`devops pipeline init` writes one'], about: 'A step creates it, so no fixture and no seed are needed.' },
    { id: 'dt-dep-secret', name: 'A secret', klass: 'step-creatable', service: 'devops-tools', envVars: [], evidence: ['`devops secret set` writes one'], about: 'A step creates it, so no fixture and no seed are needed.' },
    { id: 'dt-dep-build', name: 'An approved build', klass: 'seedable', service: 'sqlite', envVars: ['DEVOPS_STATE_DB'], evidence: ['table `builds` in state/schema.sql', 'seed script state/seed/builds.ts'], about: 'No interface creates an approved build, but the seed script does.' },
    { id: 'dt-dep-env', name: 'The environment table', klass: 'seedable', service: 'sqlite', envVars: ['DEVOPS_STATE_DB'], evidence: ['seed script state/seed/environments.ts'], about: 'No interface creates one, but the seed script does.' },
    { id: 'dt-dep-azdo', name: 'Azure DevOps project', klass: 'supplied', service: 'azure-devops', envVars: ['AZDO_ORG_URL', 'AZDO_PAT'], evidence: ['import of azure-devops-node-api in src/Clients/AzdoClient.cs'], about: 'A real external account. Nothing in the repo can create one.', storedHint: 'saved ••••77b2' },
    { id: 'dt-dep-audit', name: 'Audit sink', klass: 'supplied', service: 'datadog', envVars: ['DATADOG_API_KEY'], evidence: ['DATADOG_API_KEY read in src/Audit/Sink.cs'], about: 'A real external account. One scenario is blocked until it has values.' },
  ],
  coverage: coverage(
    DT_TESTS,
    [48, 6, 5],
    [271, 18, 24],
    [19, 2, 1],
    [10, 0, 0],
    [
      { label: 'Corpus scanned', value: 'Yesterday on 4b1e77c' },
      { label: 'Scenarios generated', value: 'Yesterday on 4b1e77c' },
      { label: 'Interfaces derived', value: 'Yesterday on 4b1e77c' },
      { label: 'Last hosted run', value: 'Yesterday on 4b1e77c' },
      { label: 'Last local run', value: '2 days ago on e30a1b7 by mushegh' },
    ],
  ),
};

export const OTHER_REPO_GUARD: Record<string, RepoGuardData> = {
  'web-console': WEB_CONSOLE,
  billing: BILLING,
  'devops-tools': DEVOPS_TOOLS,
};
