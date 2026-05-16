
// FP shape: array.filter with nested array.find to identify removed items; no type mismatch
declare const existingItems: Array<{ id: string; name: string }>;
declare const incomingItems: Array<{ id: string; name: string }>;

const removedItems = existingItems.filter(
  (existing) => !incomingItems.find((item) => item.id === existing.id)
);



// Shape: flatMap with find to validate items against a related list — no type mismatch
declare const formSections: Array<{ id: string; assigneeId: string; pageIndex?: number }>;
declare const assignees: Array<{ id: string; name: string }>;
declare const pages: Array<{ id: string }>;

export function validateSectionAssignees() {
  const validatedSections = formSections.flatMap((section) => {
    const assignee = assignees.find((a) => a.id === section.assigneeId);

    if (!assignee) {
      return [];
    }

    if (section.pageIndex !== undefined && !pages.find((p) => p.id === section.id)) {
      return [];
    }

    return [{ ...section, assignee }];
  });

  return validatedSections;
}
