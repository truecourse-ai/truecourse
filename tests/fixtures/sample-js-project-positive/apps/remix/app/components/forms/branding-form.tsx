
// FP shape f8386853394f: React.forwardRef with cn() and spread props — no type mismatch
declare function cn(...args: (string | undefined | null | boolean)[]): string;

const BrandingPreviewPanel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'compact' }
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="region"
    className={cn('space-y-4 rounded-lg border bg-background p-6', className)}
    {...props}
  />
));
BrandingPreviewPanel.displayName = 'BrandingPreviewPanel';


// tRPC useMutation with onSuccess(data) callback — standard tRPC React hook pattern, no type mismatch
declare const trpc: {
  apiToken: {
    create: {
      useMutation(opts: { onSuccess(data: { id: number; token: string; name: string }): void }): {
        mutateAsync(input: { name: string; expiresAt: Date | null }): Promise<{ id: number; token: string; name: string }>;
      };
    };
  };
};

function useCreateApiTokenForm() {
  const [newToken, setNewToken] = React.useState<{ id: number; token: string; name: string } | null>(null);

  const { mutateAsync: createApiToken } = trpc.apiToken.create.useMutation({
    onSuccess(data) {
      setNewToken(data);
    },
  });

  return { createApiToken, newToken };
}

