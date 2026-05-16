
// FP shape: array.map with optional find; no type mismatch
declare const formFields: Array<{ id: string; name: string }>;
declare const prefillData: Array<{ id: string; value: string }> | undefined;

const enriched = formFields.map((field) => ({
  ...field,
  prefill: prefillData?.find((pf) => pf.id === field.id),
}));



// FP shape: optional chain array.find predicate; no type mismatch
declare const overrideValues: Array<{ id: string; value: string }> | undefined;
declare const formField: { id: string };

const override = overrideValues?.find((v) => v.id === formField.id);



// FP shape fb0b18dbca93: flatMap + filter to collect all template field IDs — no type mismatch
declare const allRecipients: Array<{ fields: Array<{ id: string; type: string }> }>;
declare const prefillFields: Array<{ id: string; value: string }> | undefined;

function validatePrefillFields() {
  const allTemplateFieldIds = allRecipients.flatMap((recipient) => recipient.fields.map((field) => field.id));

  if (prefillFields?.length) {
    const invalidFieldIds = prefillFields
      .map((prefillField) => prefillField.id)
      .filter((id) => !allTemplateFieldIds.includes(id));

    if (invalidFieldIds.length > 0) {
      throw new Error('Invalid prefill field IDs: ' + invalidFieldIds.join(', '));
    }
  }

  return allTemplateFieldIds;
}
