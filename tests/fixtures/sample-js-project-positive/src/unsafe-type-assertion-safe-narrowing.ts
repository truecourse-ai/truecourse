/**
 * Positive fixture for bugs/deterministic/unsafe-type-assertion.
 *
 * Several `as` patterns are universally recognised as safe and the
 * rule must not flag them:
 *   - `Object.entries/keys/values(X) as ...`: re-narrowing the loose
 *     standard-library return type to a known key/value union.
 *   - `JSON.parse(JSON.stringify(x)) as T`: deep-clone idiom; the
 *     parsed value is `any`, so an assertion is the only way to
 *     recover a concrete shape.
 *   - `{} as T`: empty-object literal used to seed a React context
 *     default value or an accumulator that is filled in later.
 *   - `event.target as Node` / `as HTMLElement`: recovering a DOM
 *     node from an `EventTarget` so `.contains()` etc. are callable.
 */

type RoleKey = 'admin' | 'editor' | 'viewer';
type RoleConfig = { readonly label: string; readonly weight: number };

const ROLE_CONFIG: Record<RoleKey, RoleConfig> = {
  admin: { label: 'Admin', weight: 30 },
  editor: { label: 'Editor', weight: 20 },
  viewer: { label: 'Viewer', weight: 10 },
};

export function rolesByWeight(): [RoleKey, RoleConfig][] {
  return (Object.entries(ROLE_CONFIG) as [RoleKey, RoleConfig][]).sort(
    ([, a], [, b]) => b.weight - a.weight,
  );
}

export function roleKeys(): RoleKey[] {
  return Object.keys(ROLE_CONFIG) as RoleKey[];
}

export function cloneRoles(): Record<RoleKey, RoleConfig> {
  return JSON.parse(JSON.stringify(ROLE_CONFIG)) as Record<RoleKey, RoleConfig>;
}

type WizardContextValue = {
  step: number;
  goToStep: (step: number) => void;
};

export const wizardContextDefault = {} as WizardContextValue;

export function nodeContainsTarget(host: HTMLElement, event: MouseEvent): boolean {
  return host.contains(event.target as Node);
}

export function closestButton(event: PointerEvent): HTMLElement | null {
  const target = event.target as HTMLElement;
  return target.closest('button');
}
