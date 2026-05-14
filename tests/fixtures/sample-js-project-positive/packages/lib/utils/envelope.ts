
declare const z: { string: () => any };

// Document ID format validation /^document_\d+$/ — ASCII alphanumeric, unicode flag adds nothing.
const ZDocumentPrefixIdSchema = z.string().regex(/^document_\d+$/);
const ZTemplatePrefixIdSchema = z.string().regex(/^template_\d+$/);

export function isDocumentPrefixId(id: string): boolean {
  return ZDocumentPrefixIdSchema.safeParse(id).success;
}

export function isTemplatePrefixId(id: string): boolean {
  return ZTemplatePrefixIdSchema.safeParse(id).success;
}



declare const z: { string: () => any };

// Template ID format validation /^template_\d+$/ — ASCII-only, unicode flag unnecessary.
const ZEnvelopeTemplateIdSchema = z.string().regex(/^template_\d+$/);

export function isTemplateEnvelopeId(id: string): boolean {
  return ZEnvelopeTemplateIdSchema.safeParse(id).success;
}
