
// FP shape: function returning nested object literal with feature flags
declare type OrganisationSettings = {
  documentLanguage: string;
  documentTimezone: string;
  documentDateFormat: string;
  allowDocumentRejection: boolean;
  allowTypedSignature: boolean;
  allowDrawnSignature: boolean;
};

declare type FeatureFlags = {
  signing: {
    allowTyped: boolean;
    allowDrawn: boolean;
    allowRejection: boolean;
  };
  document: {
    language: string;
    timezone: string;
    dateFormat: string;
  };
};

export const extractFeatureFlags = (settings: OrganisationSettings): FeatureFlags => {
  return {
    signing: {
      allowTyped: settings.allowTypedSignature,
      allowDrawn: settings.allowDrawnSignature,
      allowRejection: settings.allowDocumentRejection,
    },
    document: {
      language: settings.documentLanguage,
      timezone: settings.documentTimezone,
      dateFormat: settings.documentDateFormat,
    },
  };
};
