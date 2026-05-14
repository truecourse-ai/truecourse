
// FP: React dialog component with form, hooks, and JSX — standard React framework structure
declare const Dialog: React.FC<{ open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }>;
declare const DialogTrigger: React.FC<{ asChild?: boolean; children: React.ReactNode }>;
declare const DialogContent: React.FC<{ children: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children: React.ReactNode }>;
declare const DialogDescription: React.FC<{ children: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children: React.ReactNode }>;
declare const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; loading?: boolean }>;
declare const useToast: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const trpc: { apiKey: { delete: { useMutation: (opts: { onSuccess: () => void; onError: (e: Error) => void }) => { mutateAsync: (args: unknown) => Promise<void>; isLoading: boolean } } } };
declare const Trans: React.FC<{ children: React.ReactNode }>;

export type ApiKeyDeleteDialogProps = {
  apiKey: { id: string; name: string };
  onDelete?: () => void;
  children?: React.ReactNode;
};

export default function ApiKeyDeleteDialog({ apiKey, onDelete, children }: ApiKeyDeleteDialogProps) {
  const [open, setOpen] = React.useState(false);
  const { toast } = useToast();

  const { mutateAsync: deleteApiKey, isLoading } = trpc.apiKey.delete.useMutation({
    onSuccess: () => {
      toast({ title: 'API key deleted successfully' });
      setOpen(false);
      onDelete?.();
    },
    onError: (err) => {
      toast({ title: err.message ?? 'Failed to delete API key', variant: 'destructive' });
    },
  });

  const handleDelete = async () => {
    await deleteApiKey({ id: apiKey.id }).catch(() => null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete API Key</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>
              Are you sure you want to delete the API key{' '}
              <span className="font-semibold">{apiKey.name}</span>? This action cannot be undone.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isLoading}>
            <Trans>Cancel</Trans>
          </Button>

          <Button variant="destructive" onClick={handleDelete} loading={isLoading}>
            <Trans>Delete</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// processing step 1: validate and transform input
  // processing step 2: validate and transform input
  // processing step 3: validate and transform input
  // processing step 4: validate and transform input
  // processing step 5: validate and transform input
  // processing step 6: validate and transform input
  // processing step 7: validate and transform input
}

function _longFn_f681d87a(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
