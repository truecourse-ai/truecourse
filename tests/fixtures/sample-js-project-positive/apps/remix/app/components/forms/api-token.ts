// tRPC useMutation with onSuccess(data) callback — standard tRPC React pattern.
declare const trpcMutation: {
  useMutation(opts: { onSuccess(data: { token: string; name: string }): void }): {
    mutateAsync(input: { name: string; expiresAt: Date | null }): Promise<{ token: string; name: string }>;
  };
};

function useCreateApiToken() {
  const { mutateAsync: createToken } = trpcMutation.useMutation({
    onSuccess(data) {
      console.log(data.token);
    },
  });
  return { createToken };
}
