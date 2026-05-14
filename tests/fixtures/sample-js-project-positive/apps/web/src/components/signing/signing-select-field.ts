
declare function useEffect(fn: () => void, deps?: unknown[]): void;
declare function executeAuthProcedure(opts: { onReauthFormSubmit: (authOptions: unknown) => Promise<void>; actionTarget: string }): Promise<void>;
declare const localSelection: string;
declare const field: { inserted: boolean; type: string };
declare function onSign(authOptions: unknown): Promise<void>;
declare const shouldAutoSign: boolean;

useEffect(() => {
  if (!field.inserted && localSelection) {
    void executeAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions),
      actionTarget: field.type,
    });
  }
}, [localSelection]);

useEffect(() => {
  if (shouldAutoSign) {
    void executeAuthProcedure({
      onReauthFormSubmit: async (authOptions) => await onSign(authOptions),
      actionTarget: field.type,
    });
  }
}, []);
