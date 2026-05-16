
// FP shape: function with simple destructuring and object return
type BoundingBox = [number, number, number, number];
type RawDetectedField = { bbox: BoundingBox; category: string; score: number };
type NormalizedField = { type: string; x: number; y: number; width: number; height: number; confidence: number };

export const normalizeRawField = (raw: RawDetectedField): NormalizedField => {
  const { bbox } = raw;
  const [yMin, xMin, yMax, xMax] = bbox;

  return {
    type: raw.category,
    x: xMin / 10,
    y: yMin / 10,
    width: (xMax - xMin) / 10,
    height: (yMax - yMin) / 10,
    confidence: raw.score,
  };
};


// contact.fields.map((field) => ({...})) building ORM create data — field properties correctly mapped
declare const sourceContact: {
  fields: Array<{ type: string; page: number; positionX: number; positionY: number; width: number; height: number; defaultValue: string }>;
};
declare const newReportId: string;
declare const fieldTypeIdMap: Record<string, string>;

const fieldsCreateData = sourceContact.fields.map((field) => ({
  reportId: newReportId,
  fieldTypeId: fieldTypeIdMap[field.type] ?? '',
  type: field.type,
  page: field.page,
  positionX: field.positionX,
  positionY: field.positionY,
  width: field.width,
  height: field.height,
  defaultValue: '',
  inserted: false,
}));

