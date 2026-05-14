// Middleware handler calling API with Number(fieldId) coercion — correct usage.
declare function deleteField(args: { documentId: string; fieldId: number }): Promise<void>;
declare function authenticatedMiddleware<T>(
  handler: (args: { params: { documentId: string; fieldId: string } }, user: { id: string }) => Promise<T>,
): unknown;

const deleteDocumentField = authenticatedMiddleware(async (args, _user) => {
  const { documentId, fieldId } = args.params;
  await deleteField({ documentId, fieldId: Number(fieldId) });
  return { success: true };
});
