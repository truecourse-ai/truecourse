
// FF03 — tRPC useMutation onSuccess async callback navigating to a route
declare function useMutation<TData, TVariables>(
  opts: {
    mutationFn: (vars: TVariables) => Promise<TData>;
    onSuccess?: () => Promise<void> | void;
    onError?: (err: unknown) => void;
  }
): { mutate: (vars: TVariables) => void; isPending: boolean };
declare function useNavigate(): (path: string) => Promise<void>;
declare function verifySsoToken(input: { token: string }): Promise<void>;

function useSsoConfirmation() {
  const navigate = useNavigate();
  const { mutate: confirmSso, isPending } = useMutation<void, { token: string }>({
    mutationFn: verifySsoToken,
    onSuccess: async () => {
      await navigate('/');
    },
    onError: (err) => {
      console.error(err);
    },
  });
  return { confirmSso, isPending };
}
