
declare const useLingui27: () => { t: (strings: TemplateStringsArray, ...vals: unknown[]) => string };
declare const useToast27: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const useEffect27: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useForm27: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => Promise<void>) => (e: unknown) => void; control: unknown; reset: (vals?: Partial<T>) => void; formState: { isSubmitting: boolean } };
declare const zodResolver27: (schema: unknown) => unknown;
declare const z27: { object: (shape: unknown) => unknown; string: () => { min: (n: number, opts?: unknown) => unknown }; nativeEnum: (e: unknown) => { optional: () => unknown } };
declare const trpc27: { collection: { update: { useMutation: () => { mutateAsync: (data: { collectionId: string; name: string; visibility?: string }) => Promise<void> } } } };
declare const CollectionVisibility27: Record<string, string>;
declare const useCurrentTeam27: () => { id: number } | undefined;
declare const Dialog27: React.ComponentType<{ open: boolean; onOpenChange: (v: boolean) => void; children: React.ReactNode }>;
declare const DialogContent27: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogHeader27: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogTitle27: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogDescription27: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogFooter27: React.ComponentType<{ children: React.ReactNode }>;
declare const DialogClose27: React.ComponentType<{ asChild?: boolean; children: React.ReactNode }>;
declare const Button27: React.ComponentType<{ type?: string; variant?: string; loading?: boolean; onClick?: () => void; children: React.ReactNode }>;
declare const Input27: React.ComponentType<{ placeholder?: string; [k: string]: unknown }>;
declare const Select27: React.ComponentType<{ value?: string; onValueChange?: (v: string) => void; children: React.ReactNode }>;
declare const SelectTrigger27: React.ComponentType<{ children: React.ReactNode }>;
declare const SelectValue27: React.ComponentType<{ placeholder?: string }>;
declare const SelectContent27: React.ComponentType<{ children: React.ReactNode }>;
declare const SelectItem27: React.ComponentType<{ value: string; children: React.ReactNode }>;
declare const Form27: React.ComponentType<{ form: unknown; onSubmit: (e: unknown) => void; children: React.ReactNode }>;
declare const FormField27: React.ComponentType<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem27: React.ComponentType<{ children: React.ReactNode }>;
declare const FormLabel27: React.ComponentType<{ children: React.ReactNode }>;
declare const FormControl27: React.ComponentType<{ children: React.ReactNode }>;
declare const FormMessage27: React.ComponentType;
declare const AppError27: { parseError: (err: unknown) => { code: string } };
declare const AppErrorCode27: { NOT_FOUND: string };

type CollectionRenameDialogProps27 = {
  collection: { id: string; name: string; visibility?: string } | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const ZCollectionRenameSchema27 = z27.object({
  name: z27.string().min(1, { message: 'Collection name is required' }),
  visibility: z27.nativeEnum(CollectionVisibility27 as object).optional(),
});

type TCollectionRenameSchema27 = { name: string; visibility?: string };

export const CollectionRenameDialog27 = ({ collection, isOpen, onOpenChange }: CollectionRenameDialogProps27) => {
  const { t } = useLingui27();
  const team = useCurrentTeam27();
  const { toast } = useToast27();
  const { mutateAsync: updateCollection } = trpc27.collection.update.useMutation();

  const form = useForm27<TCollectionRenameSchema27>({
    resolver: zodResolver27(ZCollectionRenameSchema27),
    defaultValues: {
      name: collection?.name ?? '',
      visibility: collection?.visibility ?? CollectionVisibility27['EVERYONE'],
    },
  });

  useEffect27(() => {
    if (collection) {
      form.reset({ name: collection.name, visibility: collection.visibility ?? CollectionVisibility27['EVERYONE'] });
    }
  }, [collection]);

  const onSubmit = async (data: TCollectionRenameSchema27) => {
    if (!collection) return;
    try {
      await updateCollection({ collectionId: collection.id, ...data });
      onOpenChange(false);
      toast({ title: t`Collection updated` });
    } catch (err) {
      const error = AppError27.parseError(err);
      if (error.code === AppErrorCode27.NOT_FOUND) {
        toast({ title: t`Collection not found`, variant: 'destructive' });
        return;
      }
      toast({ title: t`Failed to update collection`, variant: 'destructive' });
    }
  };

  return (
    <Dialog27 open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent27>
        <DialogHeader27>
          <DialogTitle27>Rename collection</DialogTitle27>
          <DialogDescription27>Update the name and visibility for this collection.</DialogDescription27>
        </DialogHeader27>

        <Form27 form={form} onSubmit={form.handleSubmit(onSubmit)}>
          <FormField27
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem27>
                <FormLabel27>Name</FormLabel27>
                <FormControl27><Input27 placeholder="My collection" {...(field as object)} /></FormControl27>
                <FormMessage27 />
              </FormItem27>
            )}
          />

          {team && (
            <FormField27
              control={form.control}
              name="visibility"
              render={({ field }) => (
                <FormItem27>
                  <FormLabel27>Visibility</FormLabel27>
                  <FormControl27>
                    <Select27 value={(field as { value?: string }).value} onValueChange={(field as { onChange: (v: string) => void }).onChange}>
                      <SelectTrigger27><SelectValue27 placeholder="Select visibility" /></SelectTrigger27>
                      <SelectContent27>
                        {Object.entries(CollectionVisibility27).map(([k, v]) => (
                          <SelectItem27 key={k} value={v}>{k}</SelectItem27>
                        ))}
                      </SelectContent27>
                    </Select27>
                  </FormControl27>
                </FormItem27>
              )}
            />
          )}

          <DialogFooter27 className="mt-4">
            <DialogClose27 asChild><Button27 variant="secondary">Cancel</Button27></DialogClose27>
            <Button27 type="submit" loading={form.formState.isSubmitting}>Save</Button27>
          </DialogFooter27>
        </Form27>
      </DialogContent27>
    </Dialog27>
  );
};
