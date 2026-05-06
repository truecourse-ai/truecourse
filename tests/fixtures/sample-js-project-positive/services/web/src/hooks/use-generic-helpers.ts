/**
 * Generic helpers whose type parameters are meaningful even when they
 * appear only once in the visible signature. The unnecessary-type-parameter
 * rule should NOT flag these.
 *
 * Mirrors:
 *   documenso `apps/remix/app/utils/super-json-loader.ts:48,53`
 *     — `useSuperLoaderData<T = AppData>(): UseDataFunctionReturn<T>`
 *   OpenHands `frontend/src/hooks/use-click-outside-element.ts:7`
 *     — `<T extends HTMLElement>` used in body via `useRef<T>(null)`
 *   OpenHands `frontend/src/components/features/home/shared/dropdown-item.tsx:16`
 *     — `<T>` used as generic-argument for the Props type
 */

interface UseDataFunctionReturn<T> {
  readonly data: T;
}

interface DropdownItemProps<T> {
  readonly item: T;
  readonly onSelect: (item: T) => void;
}

// Default value lets callers override the default with their own type.
export function useDefaultedLoader<T = { default: true }>(initial: T): UseDataFunctionReturn<T> {
  return { data: initial };
}

// Generic argument for the input type (DropdownItemProps<T>) — the outer
// type's internal fields all use T.
export function DropdownItem<T>(props: DropdownItemProps<T>): T {
  return props.item;
}

// Type parameter referenced only in body (`useRef<T>(null)` analogue).
export function makeRefHolder<T extends string>(): { readonly v: T | null } {
  const placeholder: T | null = null;
  return { v: placeholder };
}
