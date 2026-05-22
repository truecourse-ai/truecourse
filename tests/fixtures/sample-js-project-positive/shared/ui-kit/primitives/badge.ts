// `primitives/` is listed in this package's `files` field, so this module
// is part of the package's published public surface — any consumer can
// import `@sample/ui-kit/primitives/badge` as documented API.

export type BadgeTone = 'neutral' | 'success' | 'warning';

export function renderBadge(label: string, tone: BadgeTone = 'neutral'): string {
  return `[${tone}] ${label}`;
}
