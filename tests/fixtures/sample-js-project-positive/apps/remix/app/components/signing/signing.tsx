
// FP shape fd08cf739506: useMemo filtering fields by pageNumber and currentItemId — no type mismatch
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const recipientFields: Array<{ page: number; attachmentId: string; type: string }>;
declare const selectedAssistantFields: Array<{ page: number; attachmentId: string; type: string }>;
declare const recipientRole: string;
declare const pageNumber: number;
declare const currentAttachmentId: string | undefined;

const localPageFields = useMemo(() => {
  let fieldsToRender = recipientFields;

  if (recipientRole === 'ASSISTANT') {
    fieldsToRender = selectedAssistantFields;
  }

  return fieldsToRender.filter(
    (field) => field.page === pageNumber && field.attachmentId === currentAttachmentId,
  );
}, [recipientFields, selectedAssistantFields, recipientRole, pageNumber, currentAttachmentId]);
