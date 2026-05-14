// FP shape: .map augmenting typed objects with spread + extra field — no type mismatch
declare function nanoid(): string;
interface Recipient { id: string; name: string; email: string; role: string }
interface RecipientWithClientId extends Recipient { clientId: string }

function attachClientIds(recipients: Recipient[]): RecipientWithClientId[] {
  return recipients.map((recipient) => ({
    ...recipient,
    clientId: nanoid(),
  }));
}


// FP shape: typed .map result passed to JSON.stringify — no type mismatch
interface FormField { id: string; label: string; value: string; type: string }

function serializeFields(fields: FormField[]): string {
  return JSON.stringify(
    fields.map((field) => ({
      id: field.id,
      label: field.label,
      value: field.value,
      type: field.type,
    }))
  );
}


// FP shape: .map spreading items and adding a mapped id field — no type mismatch
declare function mapSecondaryIdToTemplateId(secondaryId: string): string;
interface FieldTemplate { id: string; secondaryId: string; label: string; type: string }
interface MappedField extends FieldTemplate { templateId: string }

function mapFields(fields: FieldTemplate[]): MappedField[] {
  return fields.map((field) => ({
    ...field,
    templateId: mapSecondaryIdToTemplateId(field.secondaryId),
  }));
}


// FP shape: nested .map with destructured property — no type mismatch
interface TeamMember { userId: string; name: string; email: string }
interface TeamGroup { groupId: string; teamMembers: TeamMember[] }
interface OrgGroup { organisationGroup: TeamGroup }

function extractUserIds(orgGroups: OrgGroup[]): string[] {
  return orgGroups.flatMap((group) =>
    group.organisationGroup.teamMembers.map(({ userId }) => userId)
  );
}


// FP shape: mapping typed array to object with title and spread — no type mismatch
interface ContentItem { id: string; title: string; slug: string; publishedAt: Date }
interface ContentRef { title: string; id: string; slug: string; publishedAt: Date }
declare function replace: (refs: ContentRef[]) => void;

interface ContentBlock { items: ContentItem[] }

function syncContentBlock(block: ContentBlock): void {
  replace(
    block.items.map((item) => ({
      title: item.title,
      id: item.id,
      slug: item.slug,
      publishedAt: item.publishedAt,
    }))
  );
}


// FP shape: recipients.map to explicit object with named fields — no type mismatch
interface Recipient {
  id: string;
  name: string;
  email: string;
  token: string;
  role: string;
  signingOrder: number;
}
interface RecipientDto { id: string; name: string; email: string; token: string; role: string; signingOrder: number }

function toRecipientDtos(recipients: Recipient[]): RecipientDto[] {
  return recipients.map((recipient) => ({
    id: recipient.id,
    name: recipient.name,
    email: recipient.email,
    token: recipient.token,
    role: recipient.role,
    signingOrder: recipient.signingOrder,
  }));
}


// FP shape: async .map with await inside callback — no type mismatch
interface Asset { id: string; url: string; filename: string }
interface DuplicatedAsset { originalId: string; newId: string; filename: string }
declare function duplicateAsset(asset: Asset): Promise<DuplicatedAsset>;

async function duplicateAllAssets(assets: Asset[]): Promise<DuplicatedAsset[]> {
  return Promise.all(
    assets.map(async (asset) => {
      const duplicatedAsset = await duplicateAsset(asset);
      return duplicatedAsset;
    })
  );
}


// FP shape: typed .map with let variable mutation inside callback — no type mismatch
interface SubmittedField { id: string; type: string; customText: string | null; checked: boolean }
interface ProcessedField extends SubmittedField { displayValue: string }

function processFieldValues(fields: SubmittedField[]): ProcessedField[] {
  return fields.map((field) => {
    let displayValue = field.customText ?? '';
    if (field.type === 'CHECKBOX') {
      displayValue = field.checked ? 'Yes' : 'No';
    }
    return { ...field, displayValue };
  });
}


// FP shape: filesToUpload.map(async (file) => { ... await putFile ... }) — no type mismatch
interface UploadableFile { name: string; buffer: Buffer; mimeType: string }
interface StoredFile { id: string; name: string; url: string }
declare function putNormalFile(file: { name: string; data: Buffer; type: string }): Promise<{ id: string; url: string }>;

async function uploadAllFiles(filesToUpload: UploadableFile[]): Promise<StoredFile[]> {
  return Promise.all(
    filesToUpload.map(async (file) => {
      const { id, url } = await putNormalFile({
        name: file.name,
        data: file.buffer,
        type: file.mimeType,
      });
      return { id, name: file.name, url };
    })
  );
}


// FP shape: Object.entries with Record<string,string> .map to key/value pairs — no type mismatch
interface HeaderEntry { key: string; value: string }

function parseResponseHeaders(headers: Record<string, string>): HeaderEntry[] {
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}



// H48: Buffer.from(hash(key)).toString('hex').slice(...) — correct argument types throughout, no type mismatch
declare function sha256(input: string): Buffer;
declare const Buffer: { from(data: Buffer | Uint8Array): { toString(encoding: string): string } };

function generateShortKey(rawKey: string, length: number = 24): string {
  return Buffer.from(sha256(rawKey)).toString('hex').slice(0, length);
}



// --- argument-type-mismatch shape: Buffer.from(hashFn(JSON.stringify)) ---
// sha256 returns string, Buffer.from accepts string — no type mismatch.
declare function sha256(input: string): string;
interface ResourceSnapshot {
  resourceStatus: string;
  fields: Array<{ id: number; value: string | null }>;
}
function computeEtag(snapshot: ResourceSnapshot): string {
  return Buffer.from(
    sha256(
      JSON.stringify({
        resourceStatus: snapshot.resourceStatus,
        fields: snapshot.fields.map((f) => ({ id: f.id, value: f.value ?? null })),
      }),
    ),
  ).toString('hex');
}



// --- argument-type-mismatch shape: find by id comparison ---
// items.find((e) => e.id === targetId); valid strict equality find callback, no mismatch.
interface WorkItem { id: string; order: number; title: string }
declare const workItems: WorkItem[];
function hasOrderChanged(updates: Array<{ workItemId: string; order?: number }>): boolean {
  return updates.some((update) => {
    if (update.order === undefined) return false;
    const existing = workItems.find((e) => e.id === update.workItemId);
    return !existing || existing.order !== update.order;
  });
}



// --- argument-type-mismatch shape: find with optional chaining for id lookup ---
// items.find((item) => item.title === identifier)?.documentDataId — valid optional-chain after find.
interface EnvelopeItemEntry { title: string; documentDataId: string }
declare const envelopeItems: EnvelopeItemEntry[];
function resolveDocumentDataId(identifier: string | number | undefined): string | undefined {
  if (typeof identifier === 'string') {
    return envelopeItems.find((item) => item.title === identifier)?.documentDataId;
  }
  if (typeof identifier === 'number') {
    return envelopeItems.at(identifier)?.documentDataId;
  }
  return envelopeItems.at(0)?.documentDataId;
}



// --- argument-type-mismatch shape: map creating new object shape ---
// recipients.map(r => ({...r, clientId: nanoid()})) — standard object transformation, no type mismatch.
declare function nanoid(): string;
interface RecipientInput { id?: number; email: string; name?: string; role: string; signingOrder?: number }
function attachClientIds(recipients: RecipientInput[]): Array<RecipientInput & { clientId: string }> {
  return recipients.map((recipient) => ({
    ...recipient,
    clientId: nanoid(),
  }));
}



// --- argument-type-mismatch shape: Number() conversion with || fallback ---
// Number(queryParam) || 1 — standard string-to-number coercion with default, no type mismatch.
function parsePaginationParams(query: { page?: string; perPage?: string }): { page: number; perPage: number } {
  const page = Number(query.page) || 1;
  const perPage = Number(query.perPage) || 10;
  return { page, perPage };
}
