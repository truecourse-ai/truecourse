/**
 * Form-library calls reuse the same field NAMES across read/write
 * call sites. The string IS the schema field key; extracting it
 * to a constant adds indirection without benefit. duplicate-string
 * was incorrectly flagging these.
 *
 * Positive fixture: NO duplicate-string violations should fire
 * on this file.
 */

declare const form: {
  setValue: (k: string, v: unknown) => void;
  getValues: (k: string) => unknown;
  setError: (k: string, e: unknown) => void;
  clearErrors: (k: string) => void;
  watch: (k: string) => unknown;
};

declare const t: (k: string) => string;

export function setupTeamForm(): string {
  form.setValue("teamSlug", "");
  form.setValue("teamSlug", "default-slug");
  const value = form.getValues("teamSlug");
  form.setError("teamSlug", { message: "invalid" });
  form.clearErrors("teamSlug");
  form.watch("teamSlug");

  // i18next translation keys repeated across UI sites.
  const greeting = t("common.greeting");
  const farewell = t("common.greeting");
  const fallback = t("common.greeting");
  return `${value} ${greeting} ${farewell} ${fallback}`;
}

// Computed-key access: same key referenced multiple times across
// dispatcher tables.
const dispatch: Record<string, () => void> = {};
export function call(): void {
  dispatch["create-document"]();
  dispatch["create-document"]();
  dispatch["create-document"]();
}

// Zod-style enum members: each string is a de-facto type-union
// member, not a magic value.
declare const z: { enum: <T>(values: readonly T[]) => unknown };
export const Role = z.enum(["OWNER", "ADMIN", "MANAGER"] as const);
export const Role2 = z.enum(["OWNER", "ADMIN", "MANAGER"] as const);
export const Role3 = z.enum(["OWNER", "ADMIN", "MANAGER"] as const);
