
// Wave-M08: tRPC useMutation with spread options + onSuccess callback — standard tRPC pattern
declare const DO_NOT_INVALIDATE_QUERY_ON_MUTATION: Record<string, unknown>;
declare const trpc: {
  document: {
    send: {
      useMutation: (opts: {
        onSuccess?: (data: { id: number; status: string }) => void;
        [key: string]: unknown;
      }) => { mutateAsync: (input: unknown) => Promise<unknown> };
    };
  };
};
declare const utils: {
  document: { get: { setData: (key: unknown, updater: (old: unknown) => unknown) => void } };
};
declare const initialDocument: { id: number; status: string };

const { mutateAsync: sendDocument } = trpc.document.send.useMutation({
  ...DO_NOT_INVALIDATE_QUERY_ON_MUTATION,
  onSuccess: (newData) => {
    utils.document.get.setData(
      { documentId: initialDocument.id },
      (oldData) => ({ ...(oldData as typeof initialDocument || initialDocument), ...newData }),
    );
  },
});
