
// FP shape: function with two typed positional parameters
type DocumentMetaSnapshot = {
  language?: string;
  timezone?: string;
  dateFormat?: string;
  signingOrder?: string;
};

type MetaDiff = {
  field: string;
  oldValue: unknown;
  newValue: unknown;
};

const diffDocumentMetaChanges = (
  oldData: Partial<DocumentMetaSnapshot>,
  newData: DocumentMetaSnapshot,
): MetaDiff[] => {
  const diffs: MetaDiff[] = [];
  const keys: (keyof DocumentMetaSnapshot)[] = ['language', 'timezone', 'dateFormat', 'signingOrder'];
  for (const key of keys) {
    if (oldData[key] !== newData[key]) {
      diffs.push({ field: key, oldValue: oldData[key], newValue: newData[key] });
    }
  }
  return diffs;
};
