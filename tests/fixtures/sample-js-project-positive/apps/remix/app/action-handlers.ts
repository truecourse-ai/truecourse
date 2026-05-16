
declare function saveFormSection(opts: { formId: string; sectionId: string; data: unknown }): Promise<{ id: string }>;
declare function updateFormMeta(opts: { formId: string; meta: unknown }): Promise<void>;

async function saveFormPlaceholders(formId: string, sections: { id: string; data: unknown }[], meta: unknown): Promise<void> {
  await Promise.all([
    ...sections.map((section) => saveFormSection({ formId, sectionId: section.id, data: section.data })),
    updateFormMeta({ formId, meta }),
  ]);
}

export async function onFormAutoSave(formId: string, sections: { id: string; data: unknown }[], meta: unknown): Promise<void> {
  try {
    await saveFormPlaceholders(formId, sections, meta);
  } catch (err) {
    console.error('Auto-save failed', err);
  }
}

export async function onFormSubmit(formId: string, sections: { id: string; data: unknown }[], meta: unknown): Promise<void> {
  try {
    await saveFormPlaceholders(formId, sections, meta);
  } catch (err) {
    throw new Error(`Form save failed: ${(err as Error).message}`);
  }
}



declare function saveSignerEntries(opts: { documentId: string; signers: { email: string; role: string }[] }): Promise<void>;
declare function saveSignerMeta(opts: { documentId: string; meta: unknown }): Promise<void>;

async function saveSignersData(documentId: string, signers: { email: string; role: string }[], meta: unknown): Promise<void> {
  await Promise.all([
    saveSignerEntries({ documentId, signers }),
    saveSignerMeta({ documentId, meta }),
  ]);
}

export async function onAddSignersFormSubmit(documentId: string, signers: { email: string; role: string }[], meta: unknown): Promise<void> {
  try {
    await saveSignersData(documentId, signers, meta);
  } catch (err) {
    throw new Error(`Failed to save signers: ${(err as Error).message}`);
  }
}

export async function onAddSignersFormAutoSave(documentId: string, signers: { email: string; role: string }[], meta: unknown): Promise<void> {
  try {
    await saveSignersData(documentId, signers, meta);
  } catch {
    // Auto-save failures are non-fatal
  }
}



// FP shape: data[normalizedKey] is accessed inside else-if Array.isArray(data[normalizedKey]) branch,
// so it is guaranteed to be an array. .push() is safe.
function parseMultiValueQueryParams(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};

  for (const [rawKey, value] of searchParams.entries()) {
    const normalizedKey = rawKey.toLowerCase();
    if (!(normalizedKey in data)) {
      data[normalizedKey] = value;
    } else if (Array.isArray(data[normalizedKey])) {
      (data[normalizedKey] as string[]).push(value);
    } else {
      data[normalizedKey] = [data[normalizedKey] as string, value];
    }
  }

  return data;
}
