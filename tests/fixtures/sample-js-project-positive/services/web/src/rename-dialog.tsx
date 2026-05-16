// --- cross-service-internal-import FP: shared UI library subpath (@scope/ui/primitives/*) ---
// The import below resolves to a workspace package whose name matches @<scope>/ui,
// rooted under packages/ui/ in the monorepo. It is a public shared primitive,
// not a cross-service internal import.

declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useEffect: (fn: () => void, deps: unknown[]) => void;
declare function useSharedToast(): { toast: (opts: { title: string; description?: string }) => void };
declare const Dialog: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter: React.FC<{ children?: React.ReactNode }>;
declare const Input: React.FC<{ value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; maxLength?: number }>;
declare const Label: React.FC<{ htmlFor?: string; children?: React.ReactNode }>;
declare const Button: React.FC<{ type?: string; onClick?: () => void; children?: React.ReactNode }>;

export type ItemRenameDialogProps = {
  id: string;
  initialName: string;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onSuccess?: () => Promise<void>;
  itemKind?: 'document' | 'template';
};

export const ItemRenameDialog = ({
  id,
  initialName,
  open,
  onOpenChange,
  onSuccess,
  itemKind = 'document',
}: ItemRenameDialogProps) => {
  const { toast } = useSharedToast();

  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const isTemplate = itemKind === 'template';

  const handleRename = async () => {
    try {
      // renameItem would be called here
      if (onSuccess) await onSuccess();
      onOpenChange(false);
      toast({ title: isTemplate ? 'Template renamed' : 'Document renamed' });
    } catch {
      toast({ title: 'Error', description: 'Failed to rename item' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isTemplate ? 'Rename template' : 'Rename document'}</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="item-name">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleRename}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
