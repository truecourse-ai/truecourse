
// --- expression-complexity shape: component-body-hook-and-var-setup ---
// buildEmbeddedFeatures merges feature flags with defaults using ?? for each property.
// The repeated nullish-coalescing is idiomatic config-merge code — not complex.
declare const DEFAULT_EDITOR_CONFIG: {
  general: { allowTitle: boolean; allowRecipients: boolean; allowFields: boolean };
  settings: { allowSignatureTypes: boolean; allowDateFormat: boolean } | null;
};
declare type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
declare type EditorConfig = typeof DEFAULT_EDITOR_CONFIG;

export const buildEmbeddedFeatures = (
  features: DeepPartial<EditorConfig>,
): EditorConfig => {
  return {
    general: {
      allowTitle:
        features.general?.allowTitle ?? DEFAULT_EDITOR_CONFIG.general.allowTitle,
      allowRecipients:
        features.general?.allowRecipients ?? DEFAULT_EDITOR_CONFIG.general.allowRecipients,
      allowFields:
        features.general?.allowFields ?? DEFAULT_EDITOR_CONFIG.general.allowFields,
    },
    settings:
      features.settings !== null
        ? {
            allowSignatureTypes:
              features.settings?.allowSignatureTypes ??
              DEFAULT_EDITOR_CONFIG.settings!.allowSignatureTypes,
            allowDateFormat:
              features.settings?.allowDateFormat ??
              DEFAULT_EDITOR_CONFIG.settings!.allowDateFormat,
          }
        : null,
  };
};



// --- expression-complexity shape: object-literal-and-call-arguments ---
// buildEmbeddedEditorOptions merges features into a config object with spread.
// The object literal has many properties but each is a simple nullish-coalesce.
declare const DEFAULT_CONFIG: {
  allowTitle: boolean;
  allowRecipients: boolean;
  allowRedirectUrl: boolean;
  allowCcRecipients: boolean;
};
declare type PartialConfig = { [K in keyof typeof DEFAULT_CONFIG]?: boolean };

export function buildEditorOptions(
  features: PartialConfig,
  embedded: boolean,
): typeof DEFAULT_CONFIG & { embedded: boolean } {
  return {
    embedded,
    allowTitle: features.allowTitle ?? DEFAULT_CONFIG.allowTitle,
    allowRecipients: features.allowRecipients ?? DEFAULT_CONFIG.allowRecipients,
    allowRedirectUrl: features.allowRedirectUrl ?? DEFAULT_CONFIG.allowRedirectUrl,
    allowCcRecipients: features.allowCcRecipients ?? DEFAULT_CONFIG.allowCcRecipients,
  };
}
