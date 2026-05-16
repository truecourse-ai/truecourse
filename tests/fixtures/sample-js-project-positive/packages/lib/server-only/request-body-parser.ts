// guarded-or-preinitialized-object-access: else branch after if(undefined) and else-if(Array.isArray)
function normalizeFormData(rawData: Record<string, unknown>, incomingKey: string, value: unknown): void {
  const normalizedKey = incomingKey.endsWith('[]') ? incomingKey.slice(0, -2) : incomingKey;

  if (rawData[normalizedKey] === undefined) {
    rawData[normalizedKey] = value;
  } else if (Array.isArray(rawData[normalizedKey])) {
    (rawData[normalizedKey] as unknown[]).push(value);
  } else {
    rawData[normalizedKey] = [rawData[normalizedKey], value];
  }
}
