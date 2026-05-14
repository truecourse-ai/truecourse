
// Constrained subtype preservation: T extends base shape, returned as T | undefined
export const findContactByEmail = <T extends { email: string }>(
  contacts: T[],
  userEmail: string,
  aliasEmail?: string | null,
): T | undefined =>
  contacts.find((c) => c.email === userEmail || (aliasEmail && c.email === aliasEmail));
