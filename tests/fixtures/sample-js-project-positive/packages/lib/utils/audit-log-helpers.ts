
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

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
