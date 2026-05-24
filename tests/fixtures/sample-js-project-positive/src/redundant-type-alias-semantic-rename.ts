/**
 * Type aliases that exist for semantic / API-stability reasons should
 * NOT trigger `code-quality/deterministic/redundant-type-alias`:
 *
 *   - An EXPORTED alias is the public API of the module — collapsing it
 *     forces every consumer to import a deeper path.
 *   - A LOCAL alias whose name ends with a React/TS structural-role
 *     suffix (Props, State, Settings, …) signals that the alias gives
 *     a domain-specific role to a generic type.
 */

interface DocumentDraft {
  id: string;
  body: string;
}

interface SessionLike {
  userId: string;
}

interface DocumentBrandingSnapshot {
  themeColor: string;
}

// Exported semantic re-export
export type DocumentDraftProps = DocumentDraft;

// Exported re-export of a deeper internal type
export type CurrentSession = SessionLike;

// Local alias with a "Settings" semantic suffix — the alias names the role
// (branding settings) even though it's the same shape as the snapshot.
type BrandingSettings = DocumentBrandingSnapshot;

export function describeBranding(s: BrandingSettings): string {
  return s.themeColor;
}

// Local alias with a "Value" suffix — context value role
type SessionProviderValue = SessionLike;

export function readSession(s: SessionProviderValue): string {
  return s.userId;
}
