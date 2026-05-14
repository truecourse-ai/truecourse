
declare const useLingui41: () => { _: (msg: unknown) => string };
declare const useToast41: () => { toast: (opts: { title: string; description?: string; variant?: string; duration?: number }) => void };
declare const useNavigate41: () => (path: string) => void;
declare const useState41: <T>(init: T) => [T, (v: T) => void];
declare const useEffect41: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useForm41: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: (vals?: Partial<T>) => void; formState: { isSubmitting: boolean } };
declare const zodResolver41: (schema: unknown) => unknown;
declare const z41: { object: (shape: unknown) => unknown; string: () => { nullable: () => { optional: () => unknown } } };
declare const trpc41: { asset: { moveToCollection: { useMutation: () => { mutateAsync: (data: { assetId: string; collectionId: string | null }) => Promise<void> } } }; collection: { findInternal: { useQuery: (input: unknown, opts?: unknown) => { data: Array<{ id: string; name: string; parentId: string | null }> | undefined; isLoading: boolean } } } };
declare const msg41: (strings: TemplateStringsArray, ...vals: unknown[]) => unknown;
declare const AppError41: { parseError: (err: unknown) => { code: string } };
declare const AppErrorCode41: { NOT_FOUND: string };
declare const Dialog41: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent41: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader41: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle41: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription41: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter41: React.ComponentType<{ children: React.ReactNode }>;
declare const Button41: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; disabled?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input41: React.ComponentType<{ placeholder?: string; value?: string; onChange?: (e: { target: { value: string } }) => void }>;
declare const Form41: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField41: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: { value: unknown; onChange: (v: unknown) => void } }) => React.ReactNode }>;
declare const FormItem41: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel41: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl41: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage41: React.ComponentType;
declare const Loader241: React.ComponentType<{ className?: string }>;
declare const FolderIcon41: React.ComponentType<{ className?: string }>;
declare const HomeIcon41: React.ComponentType<{ className?: string }>;
declare const SearchIcon41: React.ComponentType<{ className?: string }>;
declare const formatAssetsPath41: (team: { url: string }) => string;
declare const useCurrentTeam41: () => { id: number; url: string };
declare const CollectionType41: { ASSET: string };
declare const cn41: (...classes: unknown[]) => string;

type AssetMoveToCollectionDialogProps41 = {
  assetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCollectionId?: string;
};

const ZMoveAssetSchema41 = (z41.object as unknown as (s: unknown) => unknown)({
  collectionId: (z41.string() as unknown as { nullable: () => { optional: () => unknown } }).nullable().optional(),
});

type TMoveAssetSchema41 = { collectionId?: string | null };

export const AssetMoveToCollectionDialog41 = ({
  assetId,
  open,
  onOpenChange,
  currentCollectionId,
}: AssetMoveToCollectionDialogProps41) => {
  const { _ } = useLingui41();
  const { toast } = useToast41();
  const navigate = useNavigate41();
  const team = useCurrentTeam41();

  const [searchTerm, setSearchTerm] = useState41('');

  const form = useForm41<TMoveAssetSchema41>({
    resolver: zodResolver41(ZMoveAssetSchema41),
    defaultValues: { collectionId: currentCollectionId },
  });

  const { data: collections, isLoading } = trpc41.collection.findInternal.useQuery(
    { parentId: currentCollectionId, type: CollectionType41.ASSET },
    { enabled: open },
  );

  const { mutateAsync: moveAsset } = trpc41.asset.moveToCollection.useMutation();

  useEffect41(() => {
    if (!open) {
      form.reset();
      setSearchTerm('');
    }
  }, [open]);

  const filteredCollections = (collections ?? []).filter((c) =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const onSubmit = async (data: TMoveAssetSchema41) => {
    try {
      await moveAsset({ assetId, collectionId: data.collectionId ?? null });
      onOpenChange(false);
      toast({ title: _(msg41`Asset moved successfully`) });

      const assetsPath = formatAssetsPath41(team);
      if (data.collectionId) {
        navigate(`${assetsPath}/collections/${data.collectionId}`);
      } else {
        navigate(assetsPath);
      }
    } catch (err) {
      const error = AppError41.parseError(err);
      if (error.code === AppErrorCode41.NOT_FOUND) {
        toast({ title: _(msg41`Collection not found`), variant: 'destructive' });
        return;
      }
      toast({ title: _(msg41`Failed to move asset`), variant: 'destructive', duration: 10000 });
    }
  };

  return (
    <Dialog41 open={open} onOpenChange={onOpenChange}>
      <DialogContent41>
        <DialogHeader41>
          <DialogTitle41>Move asset to collection</DialogTitle41>
          <DialogDescription41>Select a collection to move this asset into.</DialogDescription41>
        </DialogHeader41>

        <div className="relative">
          <SearchIcon41 className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input41
            placeholder={_(msg41`Search collections...`)}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>

        <Form41 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <FormField41
            control={form.control}
            name="collectionId"
            render={({ field }) => (
              <FormItem41>
                <FormLabel41>Destination</FormLabel41>
                <FormControl41>
                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {isLoading ? (
                      <div className="flex items-center justify-center p-4">
                        <Loader241 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={cn41('flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted', !field.value && 'bg-muted font-medium')}
                          onClick={() => field.onChange(null)}
                        >
                          <HomeIcon41 className="h-4 w-4" />
                          Root
                        </button>
                        {filteredCollections.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className={cn41('flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted', field.value === c.id && 'bg-muted font-medium')}
                            onClick={() => field.onChange(c.id)}
                          >
                            <FolderIcon41 className="h-4 w-4" />
                            {c.name}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </FormControl41>
                <FormMessage41 />
              </FormItem41>
            )}
          />

          <DialogFooter41 className="mt-4">
            <Button41 type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button41>
            <Button41 type="submit" loading={form.formState.isSubmitting}>Move</Button41>
          </DialogFooter41>
        </Form41>
      </DialogContent41>
    </Dialog41>
  );
};



// FP shape: DOCUMENT_AUTH_TYPES is a Record keyed by DocumentAccessAuth enum;
// authType comes from Object.values(DocumentAccessAuth) iteration. Enum-exhaustive Record lookup.
declare const enum DocumentAccessAuth { NONE = 'NONE', REQUIRE_ACCOUNT = 'REQUIRE_ACCOUNT', SPECIFIC_EMAILS = 'SPECIFIC_EMAILS' }

interface AccessAuthConfig { label: string; description: string; hasEmailList: boolean }

const DOCUMENT_ACCESS_AUTH_TYPES = {
  [DocumentAccessAuth.NONE]: { label: 'Public', description: 'Anyone with the link can access', hasEmailList: false },
  [DocumentAccessAuth.REQUIRE_ACCOUNT]: { label: 'Account required', description: 'Must be signed in to access', hasEmailList: false },
  [DocumentAccessAuth.SPECIFIC_EMAILS]: { label: 'Specific recipients', description: 'Only listed emails can access', hasEmailList: true },
} satisfies Record<DocumentAccessAuth, AccessAuthConfig>;

function buildAccessAuthOptions(): Array<{ value: DocumentAccessAuth; label: string; description: string }> {
  return (Object.values(DocumentAccessAuth) as DocumentAccessAuth[]).map((authType) => ({
    value: authType,
    label: DOCUMENT_ACCESS_AUTH_TYPES[authType].label,
    description: DOCUMENT_ACCESS_AUTH_TYPES[authType].description,
  }));
}


// Dialog with try/catch + toast for async mutation errors — Error Boundaries guard render-time throws, not async handlers
declare function useDocumentMutation(opts: object): { mutateAsync: (data: { documentId: string; folderId: string | null }) => Promise<void> };
declare function useNotificationToast(): { notify: (opts: { title: string; description?: string; variant?: string }) => void };
declare class DocumentAppError { static parseError(err: unknown): { code: string } }

interface DocumentMoveProps {
  documentId: string;
  targetFolderId: string | null;
  onSuccess?: () => void;
}

export function useDocumentFolderMove({ documentId, targetFolderId, onSuccess }: DocumentMoveProps) {
  const { notify } = useNotificationToast();
  const mutation = useDocumentMutation({});

  const handleMove = async () => {
    try {
      await mutation.mutateAsync({ documentId, folderId: targetFolderId });
      notify({ title: 'Document moved', variant: 'default' });
      onSuccess?.();
    } catch (err) {
      const error = DocumentAppError.parseError(err);
      notify({ title: 'Failed to move document', description: error.code, variant: 'destructive' });
    }
  };

  return { handleMove };
}

