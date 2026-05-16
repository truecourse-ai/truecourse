declare function useQuery(opts: object): { data: unknown; isLoading: boolean };
declare function useMutation(opts: object): { mutateAsync: (data: object) => Promise<void> };
declare function useToast(): { toast: (opts: object) => void };

export function EnvelopeShareDialog({ envelopeId, open, onOpenChange }: { envelopeId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  // Remix v2 nested routing: root.tsx exports a global ErrorBoundary.
  // Leaf components are not expected to define their own ErrorBoundary.
  const { toast } = useToast();
  const { data: recipients } = useQuery({ queryKey: ['recipients', envelopeId] });
  const shareMutation = useMutation({ mutationFn: async (d: object) => d });

  const handleShare = async (email: string) => {
    try {
      await shareMutation.mutateAsync({ envelopeId, email });
      toast({ title: 'Shared successfully' });
    } catch {
      toast({ title: 'Share failed', variant: 'destructive' });
    }
  };

  return null;
}



// FP shape: index is obtained from findIndex returning 0..length-1 and is only used inside
// if(index !== -1) guard. The access is always within bounds.
declare type TRecipient = { id: string; email: string; role: string; signingOrder?: number };
declare function useCallback<T extends Function>(fn: T, deps: unknown[]): T;

function useRecipientManager(recipients: TRecipient[], setRecipients: (r: TRecipient[]) => void) {
  const removeRecipient = useCallback(
    (email: string) => {
      const index = recipients.findIndex((r) => r.email === email);
      if (index !== -1) {
        const updated = recipients.filter((_, i) => i !== index);
        setRecipients(updated);
      }
    },
    [recipients, setRecipients],
  );

  const updateRecipientRole = useCallback(
    (email: string, role: string) => {
      const index = recipients.findIndex((r) => r.email === email);
      if (index !== -1) {
        const updated = [...recipients];
        updated[index] = { ...recipients[index], role };
        setRecipients(updated);
      }
    },
    [recipients, setRecipients],
  );

  return { removeRecipient, updateRecipientRole };
}
