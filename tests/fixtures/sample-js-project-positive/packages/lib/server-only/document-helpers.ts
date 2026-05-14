
// FP shape: structured arg matches discriminated union param; no type mismatch
declare function fetchAssetById(opts: { id: { type: string; id: string }; type: string; format?: string }): Promise<unknown>;
declare const assetId: string;
declare const AssetType: { IMAGE: string };

async function loadAsset() {
  const result = await fetchAssetById({
    id: { type: 'assetId', id: assetId },
    type: AssetType.IMAGE,
    format: 'webp',
  });
  return result;
}



// Shape: array.find() with optional chaining to extract a property — no type mismatch
declare const uploadedAssets: Array<{ name: string; storageKey: string }>;
declare const mapping: { identifier: string };

export function resolveAssetStorageKey(): string | undefined {
  return uploadedAssets.find((asset) => asset.name === mapping.identifier)?.storageKey;
}



// Shape: array.map((item) => item.property) extracting a property — correct types, no mismatch
declare const contract: {
  attachments: Array<{ id: string; title: string; size: number }>;
};

export function getAttachmentTitles(): string[] {
  return contract.attachments.map((attachment) => attachment.title);
}



// Shape: setState with mapped items and filteredFields — valid state setter, no type mismatch
declare function setLocalContract(patch: { contractItems?: Array<{ id: string; data: unknown }>; fields?: Array<{ id: string; page: number }> }): void;
declare const contractItems: Array<{ id: string; data: unknown }>;
declare const fields: Array<{ id: string; page: number; itemId: string }>;
declare const targetItemId: string;
declare const newData: unknown;
declare const newPageCount: number;

export function applyItemReplacement(): void {
  const remainingFields = fields.filter(
    (field) => field.itemId !== targetItemId || field.page <= newPageCount,
  );

  setLocalContract({
    contractItems: contractItems.map((item) => (item.id === targetItemId ? { ...item, data: newData } : item)),
    fields: remainingFields,
  });
}



// FP: function with typed positional params including Pick — not a complex expression
interface DocumentField { id: string; type: string; value: string }
interface Recipient { id: string; email: string; name: string }

function getFieldForRecipient(
  unknownField: DocumentField,
  recipient: Pick<Recipient, 'email'>
): DocumentField | null {
  return null;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// FP: function body with simple OR-assignment — not a complex expression
interface FormField { fieldMeta?: Record<string, unknown> | null }

function processDocumentField(field: FormField) {
  const currentFieldMeta = field.fieldMeta || null;
  return currentFieldMeta;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
