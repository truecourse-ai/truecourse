/**
 * THE CATALOG JOIN — `lib/interface-pom.ts`, the pure half of the Interfaces
 * tab. Everything the tab shows beyond the catalog's own words is minted here,
 * so this is where the rules are pinned:
 *
 *  - the SIGNATURES (one of the two invented things on the page) — a web task's
 *    camelCased id and its step placeholders, a cli command's positionals and
 *    grammar, an api operation's `noun.method()` from method + path arity;
 *  - the LOCATOR CHAIN (the other) — the elements a task touches, in order;
 *  - the ROWS, one shape per surface — a web SCREEN aggregating its `of`
 *    descendants, an api OPERATION per interface (ordered by its endpoint, then
 *    GET · HEAD · POST · PUT · PATCH · DELETE), a cli COMMAND that is one
 *    interface — plus the loose entries a screens surface has no place for;
 *  - the SCREEN'S TWO TABLES — the actions across its parts, and every readable
 *    flattened into a kind, a fact and the element it is read off;
 *  - the RESOLUTION a cross-navigation runs: an interface id → the ROW that owns
 *    it, which for a web task is the screen its panel is part of and for an
 *    operation is the operation itself.
 *
 * The rules are mechanical on purpose: two readers must mint the same name for
 * the same entry, or the page starts disagreeing with itself.
 */

import { describe, it, expect } from 'vitest';
import type { GuardInterfaceRow, InterfaceResource } from '@truecourse/shared';
import {
  ENTRIES_PLACE,
  actionWhere,
  apiCallName,
  buildCommands,
  buildEndpoints,
  buildOperations,
  buildScreens,
  commandLabel,
  endpointContext,
  findInterfaceBySlug,
  looseEntries,
  memberReturns,
  memberSignature,
  parsePlaceSelectionId,
  placeSelectionForInterface,
  resolveApiEffects,
  screenActions,
  screenShowRows,
  stateTransition,
  taskLocatorChain,
  topPlaceId,
} from '@/lib/interface-pom';

type Row = GuardInterfaceRow;

const base = {
  fingerprint: 'sha256:x',
  flows: [],
  scenarioIds: [],
} satisfies Pick<Row, 'fingerprint' | 'flows' | 'scenarioIds'>;

const web = (id: string, steps: Row['steps'], extra: Partial<Row> = {}): Row => ({
  ...base,
  id,
  type: 'web',
  title: id,
  entry: { method: 'GET', path: '/' },
  steps,
  ...extra,
});

const cli = (command: string[], extra: Partial<Row> = {}): Row => ({
  ...base,
  id: `cli/${command.join('-')}`,
  type: 'cli',
  title: `truecourse ${command.join(' ')}`,
  entry: { command },
  steps: [{ kind: 'invoke', command, flags: [] }],
  ...extra,
});

/** The catalog's own id shape for an operation: the verb, then the path slugged. */
const api = (method: string, path: string, extra: Partial<Row> = {}): Row => ({
  ...base,
  id: `api/${method.toLowerCase()}${path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '')}`,
  type: 'api',
  title: `${method} ${path}`,
  entry: { method, path },
  steps: [{ kind: 'request', method, path }],
  ...extra,
});

// The SIGNATURE is the page-object reading of a member. It is minted, never
// rendered as the action's name (the runner has no task verb, so the tab leads
// with titles) — it feeds the search haystack and any surface that wants it.
describe('signatures — web', () => {
  it('camelCases the task id, stripped of its surface prefix', () => {
    expect(memberSignature(web('web/silence-rule-from-violation-card', [{ kind: 'activate', target: 'button "x"' }])))
      .toBe('silenceRuleFromViolationCard()');
  });

  it('takes one argument per {placeholder} in the step TARGETS, in step order, deduped', () => {
    const iface = web('web/reenable-rule-from-rules-panel', [
      { kind: 'activate', target: 'button "Browse Rules"' },
      { kind: 'activate', target: 'switch "Enable {rule}"' },
      { kind: 'activate', target: 'button "Confirm {rule}"' },
    ]);
    expect(memberSignature(iface)).toBe('reenableRuleFromRulesPanel(rule)');
  });

  it('names an input step with no placeholder `text` — something is typed into it', () => {
    const iface = web('web/add-repository-by-path', [
      { kind: 'input', target: 'textbox "Paste repository path..."' },
      { kind: 'activate', target: 'button "Add Repository"' },
    ]);
    expect(memberSignature(iface)).toBe('addRepositoryByPath(text)');
  });

  it('takes NOTHING from a navigate route — a route is where it runs, not an argument', () => {
    const iface = web('web/open-a-file-in-the-code-viewer', [
      { kind: 'navigate', route: '/repos/{repoId}/files/{filePath}' },
    ]);
    expect(memberSignature(iface)).toBe('openAFileInTheCodeViewer()');
  });

  it('has no return type of its own — a web task moves the WORLD, and says so as states', () => {
    const iface = web('web/silence-rule', [{ kind: 'activate', target: 'button "x"' }], {
      endState: 'rule-silenced',
    });
    expect(memberReturns(iface)).toBeUndefined();
    expect(stateTransition(iface)).toBe('→ rule-silenced');
    expect(stateTransition({ ...iface, startingState: 'repo-report-open' })).toBe(
      'repo-report-open → rule-silenced',
    );
    // One side alone is a real answer, and reads as the half it is.
    expect(stateTransition({ ...iface, endState: undefined, startingState: 'a' })).toBe('a →');
    expect(stateTransition({ ...iface, endState: undefined })).toBeUndefined();
  });
});

/**
 * THE LOCATOR CHAIN — the elements a task actually touches, under its title in
 * the Actions table. It is what says WHERE on the page the task happens, and it
 * is the half of a task a title cannot carry.
 */
describe('the locator chain', () => {
  it('joins the step targets in the order they run', () => {
    expect(
      taskLocatorChain([
        { kind: 'activate', target: 'button "More actions"' },
        { kind: 'activate', target: 'menuitem "Disable rule for this repo"' },
      ]),
    ).toBe('button "More actions" → menuitem "Disable rule for this repo"');
  });

  it('renders the targets VERBATIM, placeholders and all — the driver looks for these', () => {
    expect(taskLocatorChain([{ kind: 'activate', target: 'button "{category}"' }])).toBe('button "{category}"');
  });

  it('takes an input step by its target, like any other element', () => {
    expect(
      taskLocatorChain([
        { kind: 'input', target: 'textbox "Paste repository path..."' },
        { kind: 'activate', target: 'button "Add Repository"' },
      ]),
    ).toBe('textbox "Paste repository path..." → button "Add Repository"');
  });

  it('takes NOTHING from a navigate — a route is where the task runs, not a thing on the page', () => {
    expect(taskLocatorChain([{ kind: 'navigate', route: '/repos/{repoId}' }])).toBeUndefined();
    expect(
      taskLocatorChain([
        { kind: 'navigate', route: '/' },
        { kind: 'activate', target: 'link "{repoName}"' },
      ]),
    ).toBe('link "{repoName}"');
  });
});

describe('signatures — cli', () => {
  const disable = cli(['rules', 'disable'], {
    contract: {
      surface: 'cli',
      command: {
        path: ['truecourse', 'rules', 'disable'],
        positionals: [{ name: 'ruleKey', required: true, variadic: false }],
        options: [{ flag: '--help', short: '-h', takesValue: false, valueRequired: false, scope: 'program' }],
        io: {
          produces: {
            exits: [
              { exit: '0', when: 'the rule was disabled' },
              { exit: '1', when: 'an unknown rule key' },
              { exit: '1', when: 'a missing argument' },
            ],
          },
        },
      },
    },
  });

  it('keeps the command’s OWN name — the last argv segment, not the whole path', () => {
    expect(memberSignature(disable)).toBe('disable(ruleKey)');
  });

  it('leaves program-scope flags out — they are the program’s, not this command’s', () => {
    expect(memberSignature(disable)).not.toContain('--help');
  });

  it('summarises the command’s own flags after its positionals', () => {
    const list = cli(['rules', 'list'], {
      contract: {
        surface: 'cli',
        command: {
          path: ['truecourse', 'rules', 'list'],
          positionals: [],
          options: [
            { flag: '--domain', takesValue: true, valueRequired: true, valueHint: 'name', scope: 'command' },
            { flag: '--enabled', takesValue: false, valueRequired: false, scope: 'command' },
          ],
        },
      },
    });
    expect(memberSignature(list)).toBe('list([--domain <name>] [--enabled])');
  });

  it('elides a summary too long to read on one row, and keeps the positionals', () => {
    const many = cli(['rules', 'query'], {
      contract: {
        surface: 'cli',
        command: {
          path: ['truecourse', 'rules', 'query'],
          positionals: [{ name: 'ruleKey', required: true, variadic: false }],
          options: Array.from({ length: 12 }, (_, i) => ({
            flag: `--option-number-${i}`,
            takesValue: false,
            valueRequired: false,
            scope: 'command' as const,
          })),
        },
      },
    });
    // The positionals are what a caller MUST pass; the grammar is one click below.
    expect(memberSignature(many)).toBe('query(ruleKey, …)');
  });

  it('falls back to the step’s own flags when no grammar was derived', () => {
    const bare = cli(['add'], { steps: [{ kind: 'invoke', command: ['add'], flags: ['--json'] }] });
    expect(memberSignature(bare)).toBe('add([--json])');
  });

  it('returns the DISTINCT exit codes in first-seen order', () => {
    expect(memberReturns(disable)).toBe('0 | 1');
  });
});

describe('signatures — api', () => {
  it('mints the method from the verb and the path’s arity', () => {
    expect(apiCallName('GET', '/api/repos')).toBe('repos.list');
    expect(apiCallName('GET', '/api/repos/{id}')).toBe('repos.read');
    expect(apiCallName('POST', '/api/repos')).toBe('repos.create');
    expect(apiCallName('PATCH', '/api/repos/{id}')).toBe('repos.update');
    expect(apiCallName('PUT', '/api/repos/{id}')).toBe('repos.update');
    expect(apiCallName('DELETE', '/api/repos/{id}')).toBe('repos.delete');
  });

  it('hangs every operation of one noun off ONE receiver — its last STATIC segment', () => {
    // Not `repoRules`: the ancestors are the noun's address, not its name.
    expect(apiCallName('PATCH', '/api/repos/{id}/rules/{ruleKey}')).toBe('rules.update');
    expect(apiCallName('GET', '/api/repos/{id}/rules')).toBe('rules.list');
    expect(apiCallName('GET', '/api/repos/{id}/analytics/top-offenders')).toBe('topOffenders.list');
  });

  it('takes only the path params the receiver does not already bind, then the body', () => {
    const update = api('PATCH', '/api/repos/{id}/rules/{ruleKey}', {
      contract: {
        surface: 'api',
        operation: {
          request: { body: [{ name: 'enabled', required: true }] },
          produces: {
            statuses: [
              { status: '200' },
              { status: '400' },
              { status: '404' },
              { status: '200', when: 'a second path to the same status' },
            ],
          },
        },
      },
    });
    expect(memberSignature(update)).toBe('update(ruleKey, {enabled})');
    expect(memberReturns(update)).toBe('200 | 400 | 404');
  });

  it('says nothing about returns for an operation whose statuses nobody established', () => {
    expect(memberReturns(api('GET', '/api/repos'))).toBeUndefined();
  });
});

/**
 * THE WEB ROW — a SCREEN: a top-level place, everything that is part of it, and
 * one tally over the lot. A panel is never a row of its own, so the numbers a
 * reader skims are the numbers of the thing they can actually open.
 */
describe('screens — a top-level place and its parts', () => {
  const resources: InterfaceResource[] = [
    { id: 'repo-report', kind: 'screen', title: 'the repository report', address: '/repos/{repoId}' },
    { id: 'violations-list', kind: 'panel', title: 'the violation list', of: 'repo-report' },
    { id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repo-report' },
    { id: 'rule-row', kind: 'panel', title: 'the rule row', of: 'rules-dialog' },
    { id: 'guard-section', kind: 'screen', title: 'the Spec Guard section' },
    // A parent this registry does not carry: a top-level place, never a dropped row.
    { id: 'orphan-pane', kind: 'panel', title: 'the orphan pane', of: 'nowhere' },
  ];
  const interfaces = [
    web('web/silence-rule', [{ kind: 'activate', target: 'button "x"' }], { at: 'violations-list' }),
    web('web/open-rules-panel', [{ kind: 'activate', target: 'button "Rules"' }], {
      at: 'violations-list',
      to: 'rules-dialog',
    }),
    web('web/toggle-rule', [{ kind: 'activate', target: 'switch "Disable"' }], { at: 'rule-row' }),
    web('web/reload-report', [{ kind: 'activate', target: 'button "Reload"' }], { at: 'repo-report' }),
    web('web/open-home', [{ kind: 'navigate', route: '/' }], { to: 'repo-report' }),
    // Another surface's row must never land in this surface's rows.
    cli(['rules', 'list'], { resource: 'violations-list' }),
  ];
  const screens = buildScreens('web', resources, interfaces);

  it('makes a row of every TOP-LEVEL place, and of nothing else', () => {
    expect(screens.map((s) => s.place.id)).toEqual(['repo-report', 'guard-section', 'orphan-pane']);
    expect(screens.map((s) => s.id)).toEqual(['web:repo-report', 'web:guard-section', 'web:orphan-pane']);
    expect(parsePlaceSelectionId('web:repo-report')).toEqual({ surface: 'web', placeId: 'repo-report' });
    expect(parsePlaceSelectionId('nothing')).toBeNull();
  });

  it('carries the screen first, then everything `of` it at ANY depth, in registry order', () => {
    const report = screens[0]!;
    expect(report.parts.map((p) => p.place.id)).toEqual([
      'repo-report',
      'violations-list',
      'rules-dialog',
      'rule-row',
    ]);
  });

  it('tallies the screen AND its parts — the number a reader is choosing between', () => {
    const report = screens[0]!;
    expect(report.count).toBe(4);
    expect(report.parts.map((p) => p.members.map((m) => m.id))).toEqual([
      ['web/reload-report'],
      ['web/silence-rule', 'web/open-rules-panel'],
      [],
      ['web/toggle-rule'],
    ]);
  });

  it('lays the screen’s ACTIONS out flat, in part order, each carrying its part', () => {
    // Every task on the screen is ONE row; which part it sits on is a column.
    expect(screenActions(screens[0]!).map((a) => [a.iface.id, a.part.id])).toEqual([
      ['web/reload-report', 'repo-report'],
      ['web/silence-rule', 'violations-list'],
      ['web/open-rules-panel', 'violations-list'],
      ['web/toggle-rule', 'rule-row'],
    ]);
  });

  it('names the part a column has room for — the article goes, the screen stays "the screen"', () => {
    const report = screens[0]!;
    expect(actionWhere(report, report.place)).toBe('the screen');
    expect(actionWhere(report, report.parts[1]!.place)).toBe('violation list');
    expect(actionWhere(report, report.parts[2]!.place)).toBe('Rules dialog');
  });

  it('leaves a screen nothing acts on at ZERO — the answer the panel hides the row on', () => {
    expect(screens.find((s) => s.place.id === 'guard-section')?.count).toBe(0);
  });

  it('roots every place of a CYCLE on itself — a ring has no top, and no row may vanish', () => {
    const ring: InterfaceResource[] = [
      { id: 'a', kind: 'panel', title: 'a', of: 'b' },
      { id: 'b', kind: 'panel', title: 'b', of: 'a' },
    ];
    expect(topPlaceId('a', ring)).toBe('a');
    expect(buildScreens('web', ring, []).map((s) => s.place.id)).toEqual(['a', 'b']);
    expect(topPlaceId('gone', ring)).toBeUndefined();
  });

  it('keeps a task that names no place as a loose ENTRY of its surface', () => {
    expect(looseEntries('web', resources, interfaces).map((j) => j.id)).toEqual(['web/open-home']);
  });

  it('treats a place id the registry does not carry as loose — never a dangling row', () => {
    const stray = web('web/stray', [{ kind: 'activate', target: 'button "x"' }], { at: 'not-a-place' });
    expect(looseEntries('web', resources, [stray]).map((j) => j.id)).toEqual(['web/stray']);
  });
});

/**
 * WHAT A SCREEN SHOWS, flattened into table rows: the four readable kinds as one
 * vocabulary, each row carrying the ELEMENT it is read off in the words
 * `describeWebLocator` produces — the same words a step and a failure use.
 */
describe('the shows table', () => {
  const resources: InterfaceResource[] = [
    {
      id: 'repo-report',
      kind: 'screen',
      title: 'the repository report',
      readables: {
        // A marker with no `within` is read off the whole place — no locator.
        markers: [{ marker: 'No analysis yet', when: 'never analyzed' }],
      },
    },
    {
      id: 'violations-list',
      kind: 'panel',
      title: 'the violation list',
      of: 'repo-report',
      readables: {
        markers: [{ marker: 'Disabled', within: { role: 'dialog', name: 'Rules' } }],
        elements: [{ element: { role: 'list', name: 'Violations' } }],
        controls: [{ control: { role: 'switch', name: 'Disable' }, states: ['checked', 'disabled'] }],
        rows: [
          { item: 'listitem', template: '<ruleName>', slots: [{ name: 'ruleName', kind: 'text' }] },
          {
            item: 'row',
            within: { role: 'table', name: 'Top Offenders' },
            template: '<rank> <name>',
            slots: [
              { name: 'rank', kind: 'count' },
              { name: 'name', kind: 'text' },
            ],
          },
        ],
      },
    },
    // A part with no readables at all contributes nothing — absence is not "none".
    { id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repo-report' },
  ];
  const screen = buildScreens('web', resources, [])[0]!;
  const rows = screenShowRows(screen);

  it('gathers every readable across the parts, in part order and kind order', () => {
    expect(rows.map((r) => [r.part.id, r.kind])).toEqual([
      ['repo-report', 'shows'],
      ['violations-list', 'shows'],
      ['violations-list', 'lists'],
      ['violations-list', 'lists'],
      ['violations-list', 'renders'],
      ['violations-list', 'click'],
    ]);
  });

  it('reads a MARKER’s locator off its `within`, and records none when it has none', () => {
    expect(rows[0]).toMatchObject({ what: '“No analysis yet”', when: 'never analyzed' });
    // Absent, not an invented "anywhere": the column renders the em dash.
    expect(rows[0]!.locator).toBeUndefined();
    expect(rows[1]).toMatchObject({ what: '“Disabled”', locator: 'in dialog “Rules”' });
  });

  it('reads a ROW GRAMMAR’s locator as its ITEM role, scoped by the container when it has one', () => {
    // The item's role IS the addressable thing — a name would differ per item.
    expect(rows[2]).toMatchObject({ what: '<ruleName>', locator: 'listitem' });
    expect(rows[3]).toMatchObject({ what: '<rank> <name>', locator: 'row · in table “Top Offenders”' });
  });

  it('reads an ELEMENT as its own name, located by its full locator', () => {
    expect(rows[4]).toMatchObject({ what: '“Violations”', locator: 'list “Violations”' });
  });

  it('reads a CONTROL as the states it EXPOSES — never a value the catalog never took', () => {
    expect(rows[5]).toMatchObject({ what: 'exposes checked, disabled', locator: 'switch “Disable”' });
  });

  it('says nothing at all for a screen nobody wrote readables for', () => {
    const bare = buildScreens('web', [{ id: 'x', kind: 'screen', title: 'x' }], [])[0]!;
    expect(screenShowRows(bare)).toEqual([]);
  });
});

/**
 * THE API ROW — an OPERATION: one interface, which is the thing a caller calls.
 * The REST NOUN is the ORDER rather than a row, and the noun's own operations
 * come out GET · HEAD · POST · PUT · PATCH · DELETE, then by path.
 */
describe('operations — one row per interface, ordered by endpoint', () => {
  const resources: InterfaceResource[] = [
    { id: 'api', kind: 'rest-noun', title: '/api' },
    { id: 'api-repos', kind: 'rest-noun', title: '/api/repos', of: 'api' },
    { id: 'api-repos-rules', kind: 'rest-noun', title: '/api/repos/{id}/rules', of: 'api-repos' },
  ];
  const interfaces = [
    api('POST', '/api/repos', { resource: 'api-repos' }),
    api('GET', '/api/repos', { resource: 'api-repos' }),
    api('DELETE', '/api/repos/{id}', { resource: 'api-repos' }),
    api('PUT', '/api/repos/{id}', { resource: 'api-repos' }),
    api('HEAD', '/api/repos', { resource: 'api-repos' }),
    api('GET', '/api/repos/{id}', { resource: 'api-repos' }),
    api('PATCH', '/api/repos/{id}/rules/{ruleKey}', { resource: 'api-repos-rules' }),
    api('GET', '/api/repos/{id}/rules', { resource: 'api-repos-rules' }),
  ];
  const operations = buildOperations('api', resources, interfaces);

  it('keeps one endpoint’s operations adjacent, in the endpoint’s registry order', () => {
    // `/api` serves nothing, so it contributes no row at all; `/api/repos` comes
    // before its child noun because the registry names it first.
    expect(operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /api/repos',
      'GET /api/repos/{id}',
      'HEAD /api/repos',
      'POST /api/repos',
      'PUT /api/repos/{id}',
      'DELETE /api/repos/{id}',
      'GET /api/repos/{id}/rules',
      'PATCH /api/repos/{id}/rules/{ruleKey}',
    ]);
  });

  it('addresses each row by its own interface slug, and carries the endpoint it is on', () => {
    expect(operations[0]!.id).toBe('api:get-api-repos');
    expect(operations.map((o) => o.place?.id).slice(0, 2)).toEqual(['api-repos', 'api-repos']);
  });

  it('keeps an operation whose noun the registry does not carry, at the END', () => {
    const stray = api('GET', '/api/loose', { resource: 'not-a-noun' });
    const rows = buildOperations('api', resources, [...interfaces, stray]);
    const last = rows[rows.length - 1]!;
    expect(last.path).toBe('/api/loose');
    // No endpoint at all — two paths are not one endpoint because nobody grouped them.
    expect(last.place).toBeUndefined();
  });

  it('keeps a noun no operation serves as an ENDPOINT — the panel counts it out', () => {
    expect(buildEndpoints('api', resources, interfaces).map((e) => [e.place.id, e.members.length])).toEqual([
      ['api', 0],
      ['api-repos', 6],
      ['api-repos-rules', 2],
    ]);
  });

  it('names an operation’s endpoint and its SIBLINGS, in the same order the panel lists them', () => {
    const rules = interfaces[6]!;
    const context = endpointContext(rules, resources, interfaces);
    expect(context.place?.title).toBe('/api/repos/{id}/rules');
    expect(context.siblings.map((s) => `${s.entry.method} ${s.entry.path}`)).toEqual([
      'GET /api/repos/{id}/rules',
    ]);
  });

  it('gives an operation the registry names no noun for no endpoint and no siblings', () => {
    const stray = api('GET', '/api/loose', { resource: 'not-a-noun' });
    expect(endpointContext(stray, resources, [...interfaces, stray])).toEqual({ siblings: [] });
  });
});

/** THE CLI ROW — one interface, addressed by its own slug. */
describe('commands — one row per interface', () => {
  const derived = cli(['rules', 'disable']);
  const authored: GuardInterfaceRow = { ...cli(['rules', 'enable']), title: 'Turn a rule back on' };

  it('reads as the WHOLE command path when the catalog titles it that way', () => {
    expect(commandLabel(derived)).toBe('truecourse rules disable');
  });

  it('falls back to the argv for an entry titled in prose — a row is a command, not a sentence', () => {
    expect(commandLabel(authored)).toBe('rules enable');
  });

  it('addresses a command by its surface and its slug, and resolves back to it', () => {
    const rows = buildCommands('cli', [derived, authored, api('GET', '/x')]);
    expect(rows.map((r) => r.id)).toEqual(['cli:rules-disable', 'cli:rules-enable']);
    expect(findInterfaceBySlug('cli', 'rules-disable', [derived, authored])?.id).toBe(derived.id);
    expect(findInterfaceBySlug('cli', 'gone', [derived])).toBeUndefined();
  });
});

/**
 * THE RESOLUTION every cross-navigation runs. One rule, so a jump can never land
 * on a row the list is not showing.
 */
describe('resolving an interface id to the row that owns it', () => {
  const resources: InterfaceResource[] = [
    { id: 'repo-report', kind: 'screen', title: 'the repository report' },
    { id: 'violations-list', kind: 'panel', title: 'the violation list', of: 'repo-report' },
  ];

  it('sends a web task to the SCREEN its panel is part of — a panel is no destination', () => {
    const task = web('web/silence-rule', [{ kind: 'activate', target: 'b' }], { at: 'violations-list' });
    expect(placeSelectionForInterface(task, resources)).toBe('web:repo-report');
  });

  it('sends an operation and a command to THEMSELVES — each is already its own row', () => {
    const nouns: InterfaceResource[] = [{ id: 'todos', kind: 'rest-noun', title: '/todos' }];
    const read = api('GET', '/todos/{id}', { resource: 'todos' });
    expect(placeSelectionForInterface(read, nouns)).toBe('api:get-todos-id');
    // The endpoint is not the destination any more — the operation is.
    expect(findInterfaceBySlug('api', 'get-todos-id', [read])?.id).toBe(read.id);
    expect(placeSelectionForInterface(cli(['rules', 'disable']), [])).toBe('cli:rules-disable');
  });

  it('resolves an operation whose noun is unknown to itself too — never to a group', () => {
    const stray = api('GET', '/api/loose', { resource: 'not-a-noun' });
    expect(placeSelectionForInterface(stray, [])).toBe('api:get-api-loose');
  });

  it('lands a web member with no place on its surface’s ENTRIES — the group that HAS a row for it', () => {
    const loose = web('web/open-home', [{ kind: 'navigate', route: '/' }]);
    expect(placeSelectionForInterface(loose, resources)).toBe(`web:${ENTRIES_PLACE}`);
    const dangling = web('web/stray', [{ kind: 'activate', target: 'b' }], { at: 'gone' });
    expect(placeSelectionForInterface(dangling, resources)).toBe(`web:${ENTRIES_PLACE}`);
    expect(placeSelectionForInterface(loose, undefined)).toBe(`web:${ENTRIES_PLACE}`);
  });
});

describe('the calls block', () => {
  const catalog = [api('GET', '/api/repos/{id}/rules'), api('PATCH', '/api/repos/{id}/rules/{ruleKey}')];

  it('joins each id to its api entry and mints the same name the api page object shows', () => {
    const calls = resolveApiEffects([catalog[1]!.id, catalog[0]!.id], catalog);
    expect(calls).toEqual([
      {
        id: catalog[1]!.id,
        name: 'rules.update',
        operation: 'PATCH /api/repos/{id}/rules/{ruleKey}',
      },
      { id: catalog[0]!.id, name: 'rules.list', operation: 'GET /api/repos/{id}/rules' },
    ]);
  });

  it('keeps an id that resolves to NOTHING — absence stays visible', () => {
    expect(resolveApiEffects(['api/gone'], catalog)).toEqual([{ id: 'api/gone' }]);
  });
});
