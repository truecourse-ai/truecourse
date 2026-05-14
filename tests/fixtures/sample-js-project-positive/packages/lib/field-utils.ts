// JSON.parse(JSON.stringify(x)) deep-clone of a typed array — round-trip guaranteed to produce valid JSON
type FieldEntry = { id: string; page: number; positionX: number; positionY: number };

function sortFieldsByPosition(fields: FieldEntry[]): FieldEntry[] {
  const clonedFields: FieldEntry[] = JSON.parse(JSON.stringify(fields));
  return clonedFields.sort((a, b) => a.page - b.page || a.positionY - b.positionY);
}
