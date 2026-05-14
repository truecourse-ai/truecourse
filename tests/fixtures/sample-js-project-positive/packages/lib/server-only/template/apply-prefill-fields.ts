interface PrefillField {
  id: string;
  value: string;
}

interface ApplyPrefillOptions {
  templateFieldIds: string[];
  prefillFields?: PrefillField[];
}

declare class AppError extends Error { constructor(code: string, opts?: object) {} }

export const validatePrefillFields = ({ templateFieldIds, prefillFields }: ApplyPrefillOptions) => {
  if (prefillFields?.length) {
    // Validate that all prefill field IDs exist in the template
    const invalidFieldIds = prefillFields
      .map((f) => f.id)
      .filter((id) => !templateFieldIds.includes(id));

    if (invalidFieldIds.length > 0) {
      throw new AppError('INVALID_BODY', {
        message: `The following field IDs do not exist in the template: ${invalidFieldIds.join(', ')}`,
      });
    }
  }

  return prefillFields ?? [];
};
