/**
 * redundant-type-argument shape that should NOT fire:
 *
 * - `Array<Field & { extra: T }>` — intersection type argument
 *   that wouldn't survive a `T[]` rewrite (the intersection is
 *   in the user's explicit type, not a default).
 * - `new Set<MyTaggedType>(...)` — explicit type argument that
 *   constrains the literal element type. Removing it would
 *   broaden the inferred type to `Set<string>` and lose the tag.
 */

interface Field {
  readonly id: string;
}

interface Signature {
  readonly value: string;
}

export type RecipientFields = Array<
  Field & { signature: Signature | null }
>;

type SettingProminence = "critical" | "major" | "minor";
type SettingsView = "basic" | "advanced" | "all";

export const VIEW_PROMINENCES: Record<SettingsView, Set<SettingProminence>> = {
  basic: new Set<SettingProminence>(["critical"]),
  advanced: new Set<SettingProminence>(["critical", "major"]),
  all: new Set<SettingProminence>(["critical", "major", "minor"]),
};
