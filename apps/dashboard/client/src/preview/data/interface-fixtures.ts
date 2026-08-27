/**
 * The fake interface catalog (./orders-api.catalog.ts, ./other-repos.ts) folded
 * into the EXACT payload shape the vendored INTERFACES surfaces consume,
 * so the Interfaces tab renders the vendored `GuardInterfacesPanel` /
 * `GuardInterfacesPane` / `GuardInterfaceDiagram` unchanged over fake data.
 *
 * One catalog entry is one interface row: a `cli:orders-create` command becomes
 * `cli/orders-create` with an invoke step carrying its flags, an api operation
 * becomes a request step on its method and path template, and a web task becomes
 * the navigate / input / activate chain its steps describe. A row's REVERSE
 * INDEX is derived from the board: the flows whose tests name the interface,
 * realized when the test produced a scenario and carrying that test's gap when it
 * did not, so a blocked interface says what it is waiting on, in the same words
 * the Tests tab uses.
 *
 * `InterfaceEntrySchema` has two shapes (a command path, an HTTP operation), so a
 * web place is rooted at its ADDRESS as the command path: `interfaceEntryLabel`
 * then renders the address itself, which is exactly what identifies a screen.
 *
 * The catalog's own RESOURCE REGISTRY rides on the view, one list per surface:
 * the fake board groups every entry under a `family` ("orders", "auth"), which is
 * the place that owns it, so each family becomes a resource the rows point at
 * through `resource` (and a web task's `at`), and the panel groups by it.
 *
 * Every detected surface reads `runnable`, because in this fake repository every
 * surface has tests that ran. The registry's own answer is kept for the surfaces
 * this repository has no code for, which the banner drops anyway.
 */

import { GUARD_DRIVERS, guardDriver } from '@/preview/vendor/shared';
import type {
  GuardDriverId,
  GuardInterfaceFlowRef,
  GuardInterfaceRow,
  GuardInterfaceSurface,
  GuardInterfacesView,
  InterfaceEntry,
  InterfaceResource,
  InterfaceResourceKind,
  InterfaceStep,
} from '@/preview/vendor/shared';
import {
  GENERATED_AT,
  fakeFingerprint,
  flowIdFor,
  gapFor,
  hasScenario,
  scenarioIdFor,
  slugify,
  testsForRepo,
} from './flow-fixtures';
import { REPO_GUARD } from './index';
import type { GuardInterface, InterfaceSurface } from './types';

/** `cli:orders-create` is the catalog's id; `cli/orders-create` is the row's. */
export function interfaceIdFor(iface: GuardInterface): string {
  return iface.id.replace(':', '/');
}

/** The family an entry belongs to, as the kebab-case id a resource is keyed by. */
export function resourceIdFor(iface: GuardInterface): string {
  return slugify(`${iface.surface}-${iface.family}`);
}

function entryFor(iface: GuardInterface): InterfaceEntry {
  if (iface.api) return { method: iface.api.method, path: iface.api.path };
  if (iface.cli) return { command: iface.cli.command.split(' ') };
  return { command: [iface.web?.address ?? iface.id] };
}

/** The web vocabulary in the shared step vocabulary: move, put a value, act. */
function webStepKind(action: string): 'navigate' | 'input' | 'activate' {
  if (action === 'navigate') return 'navigate';
  if (action === 'type' || action === 'choose') return 'input';
  return 'activate';
}

function stepsFor(iface: GuardInterface): InterfaceStep[] {
  if (iface.cli) {
    return [
      {
        kind: 'invoke',
        command: iface.cli.command.split(' '),
        flags: iface.cli.flags.map((f) => f.name).filter((n) => n.startsWith('--')),
        label: iface.summary,
      },
    ];
  }
  if (iface.api) {
    return [{ kind: 'request', method: iface.api.method, path: iface.api.path, label: iface.summary }];
  }
  return (iface.web?.steps ?? []).map((step) => {
    const kind = webStepKind(step.action);
    const label = `${step.action} ${step.target}`;
    return kind === 'navigate'
      ? { kind, route: step.target, label }
      : { kind, target: step.target, label };
  });
}

/** The flows whose tests reach this interface, realized or blocked with its reason. */
function flowRefsFor(repoId: string, iface: GuardInterface): GuardInterfaceFlowRef[] {
  const byFlow = new Map<string, GuardInterfaceFlowRef>();
  for (const test of testsForRepo(repoId)) {
    if (!test.interfacesUsed.includes(iface.id)) continue;
    const flowId = flowIdFor(test);
    const realized = hasScenario(test);
    const existing = byFlow.get(flowId);
    if (existing?.realized) continue;
    const gap = realized ? null : gapFor(test);
    byFlow.set(flowId, {
      flowId,
      title: test.flow,
      realized,
      ...(gap ? { gap } : {}),
    });
  }
  return [...byFlow.values()];
}

function scenarioIdsFor(repoId: string, iface: GuardInterface): string[] {
  return testsForRepo(repoId)
    .filter((t) => t.interfacesUsed.includes(iface.id))
    .map((t) => scenarioIdFor(repoId, t))
    .filter((id): id is string => id !== null);
}

function interfaceRow(repoId: string, iface: GuardInterface): GuardInterfaceRow {
  const resource = resourceIdFor(iface);
  return {
    id: interfaceIdFor(iface),
    type: iface.surface as GuardDriverId,
    title: iface.summary,
    group: iface.family,
    entry: entryFor(iface),
    steps: stepsFor(iface),
    resource,
    // A web task ACTS ON the place it runs in; a command or an operation is
    // merely registered under one, which `resource` alone already says.
    ...(iface.surface === 'web' ? { at: resource } : {}),
    fingerprint: fakeFingerprint(`${iface.id}/${iface.fingerprint}`),
    flows: flowRefsFor(repoId, iface),
    scenarioIds: scenarioIdsFor(repoId, iface),
    source: 'tree',
    origin: iface.origin,
  };
}

/** The place kind each surface registers its entries under. */
const RESOURCE_KIND: Record<InterfaceSurface, InterfaceResourceKind> = {
  cli: 'command-group',
  api: 'rest-noun',
  web: 'screen',
};

/**
 * The catalog's resource registry, per surface: one place per family, carrying
 * the title the panel heads its group with and, for a screen, the address a
 * navigate step reaches it by.
 */
export function resourcesFor(repoId: string): Record<string, InterfaceResource[]> {
  const interfaces = REPO_GUARD[repoId]?.interfaces ?? [];
  const registry: Record<string, InterfaceResource[]> = {};
  for (const iface of interfaces) {
    const list = (registry[iface.surface] ??= []);
    const id = resourceIdFor(iface);
    if (list.some((r) => r.id === id)) continue;
    const kind = RESOURCE_KIND[iface.surface];
    list.push({
      id,
      kind,
      title: iface.family,
      ...(kind === 'screen' && iface.web?.address ? { address: iface.web.address } : {}),
      description: `The ${iface.surface} ${iface.family} surface.`,
    });
  }
  return registry;
}

/** The Interfaces payload. */
export function interfacesView(repoId: string): GuardInterfacesView {
  const catalog = REPO_GUARD[repoId]?.interfaces ?? [];
  const interfaces = catalog.map((iface) => interfaceRow(repoId, iface));
  const resources = resourcesFor(repoId);
  const surfaces: GuardInterfaceSurface[] = GUARD_DRIVERS.map((driver) => {
    const mine = interfaces.filter((j) => j.type === driver.id);
    const places = resources[driver.id]?.length ?? 0;
    const detected = mine.length > 0 || places > 0;
    const runnable = detected || driver.runnable;
    const waitingLabel = guardDriver(driver.id)?.waitingLabel;
    return {
      surface: driver.id,
      label: driver.label,
      runnable,
      ...(runnable || !waitingLabel ? {} : { waitingLabel }),
      interfaces: mine.length,
      resources: places,
      detected,
      source: 'tree' as const,
    };
  });
  const grounded = interfaces.filter((j) => j.flows.length > 0).length;
  return {
    mapped: interfaces.length > 0,
    generatedAt: GENERATED_AT,
    recipeFingerprint: fakeFingerprint(`${repoId}/recipe`),
    interfaces,
    resources,
    surfaces,
    totals: {
      interfaces: interfaces.length,
      detectedSurfaces: surfaces.filter((s) => s.detected).length,
      grounded,
      ungrounded: interfaces.length - grounded,
    },
  };
}
