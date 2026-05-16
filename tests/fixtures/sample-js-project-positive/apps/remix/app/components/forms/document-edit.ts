// tRPC useMutation with onSuccess callback — standard tRPC React pattern.
declare const documentTrpc: {
  update: {
    useMutation(opts: { onSuccess(data: { id: string; title: string }): void }): {
      mutateAsync(input: { id: string; title: string }): Promise<{ id: string; title: string }>;
    };
  };
};

function useDocumentEditor() {
  const { mutateAsync: updateDocument } = documentTrpc.update.useMutation({
    onSuccess(data) {
      console.log('Updated:', data.title);
    },
  });
  return { updateDocument };
}
