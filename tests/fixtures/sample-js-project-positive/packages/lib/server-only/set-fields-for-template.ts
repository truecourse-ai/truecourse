declare function deleteExistingTemplateFields(templateId: string): Promise<void>;
declare function insertTemplateField(templateId: string, field: { name: string; type: string }): Promise<{ id: string }>;

export async function setFieldsForTemplate(
  templateId: string,
  fields: Array<{ name: string; type: string }>,
) {
  await deleteExistingTemplateFields(templateId);
  const created = await Promise.all(
    fields.map((f) => insertTemplateField(templateId, f)),
  );
  return created;
}
