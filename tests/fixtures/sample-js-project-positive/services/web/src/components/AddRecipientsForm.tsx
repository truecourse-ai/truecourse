declare const useState: <T>(init: T) => [T, (v: T) => void];
declare const useCallback: <T extends (...args: any[]) => any>(fn: T, deps: any[]) => T;
declare const useRef: <T>(init: T) => { current: T };
declare const useId: () => string;
declare function useFieldArray(opts: { control: any; name: string; keyName?: string }): { fields: any[]; append: (v: any) => void; remove: (i: number) => void; move: (from: number, to: number) => void };
declare function useForm<T>(opts?: any): { control: any; handleSubmit: (fn: (data: T) => void) => (e?: any) => void; formState: { errors: any; isSubmitting: boolean }; watch: (name: string) => any; setValue: (name: string, value: any) => void };
declare function zodResolver(schema: any): any;
declare const z: { object: (shape: any) => any; array: (s: any) => any; string: () => any; boolean: () => any; number: () => any; optional: () => any };
declare const cn: (...classes: any[]) => string;
declare function useToast(): { toast: (opts: { title?: string; description?: string; variant?: string }) => void };
declare const DragDropContext: any;
declare const Droppable: any;
declare const Draggable: any;
declare const Form: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormControl: any;
declare const FormMessage: any;
declare const Button: any;
declare const Input: any;
declare const Checkbox: any;
declare const Tooltip: any;
declare const TooltipTrigger: any;
declare const TooltipContent: any;
declare const GripIcon: any;
declare const TrashIcon: any;
declare const PlusIcon: any;
declare const HelpCircleIcon: any;
declare const motion: any;
declare const nanoid: () => string;
declare function canRecipientBeEdited(nativeId: string | null): boolean;

type RecipientRow = {
  id: string;
  nativeId: string | null;
  email: string;
  name: string;
  role: 'signer' | 'viewer' | 'approver';
  signingOrder: number | null;
};

type AddRecipientsFormProps = {
  flowStep: { title: string; description: string; stepIndex: number; totalSteps: number };
  recipients: RecipientRow[];
  onSubmit: (data: { recipients: RecipientRow[] }) => Promise<void>;
  onBack: () => void;
  isOrderedSigning: boolean;
};

export function AddRecipientsForm({
  flowStep,
  recipients,
  onSubmit,
  onBack,
  isOrderedSigning,
}: AddRecipientsFormProps) {
  const formId = useId();
  const { toast } = useToast();
  const sensorApiRef = useRef<any>(null);

  const [showOrderConfirm, setShowOrderConfirm] = useState(false);

  const form = useForm<{ recipients: RecipientRow[]; signingOrder: boolean }>({
    resolver: zodResolver(
      z.object({
        recipients: z.array(
          z.object({
            id: z.string(),
            nativeId: z.string().optional(),
            email: z.string(),
            name: z.string(),
            role: z.string(),
            signingOrder: z.number().optional(),
          }),
        ),
        signingOrder: z.boolean(),
      }),
    ),
    defaultValues: {
      recipients: recipients.length > 0 ? recipients : [{ id: nanoid(), nativeId: null, email: '', name: '', role: 'signer', signingOrder: null }],
      signingOrder: isOrderedSigning,
    },
  });

  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'recipients',
    keyName: 'fieldId',
  });

  const watchSigningOrder = form.watch('signingOrder');

  const handleAddRecipient = useCallback(() => {
    const nextOrder = watchSigningOrder ? fields.length + 1 : null;
    append({ id: nanoid(), nativeId: null, email: '', name: '', role: 'signer', signingOrder: nextOrder });
  }, [append, fields.length, watchSigningOrder]);

  const handleRemoveRecipient = useCallback(
    (index: number) => {
      if (fields.length === 1) {
        toast({ title: 'At least one recipient required', variant: 'destructive' });
        return;
      }
      remove(index);
    },
    [fields.length, remove, toast],
  );

  const handleDragEnd = useCallback(
    (result: any) => {
      if (!result.destination) return;
      move(result.source.index, result.destination.index);
      fields.forEach((_field, idx) => {
        form.setValue(`recipients.${idx}.signingOrder`, idx + 1);
      });
    },
    [fields, form, move],
  );

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await onSubmit(data);
    } catch {
      toast({ title: 'Failed to save recipients', variant: 'destructive' });
    }
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <h2 className="text-lg font-semibold">{flowStep.title}</h2>
        <p className="text-sm text-muted-foreground">{flowStep.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Form {...form}>
          <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-y-4">
            <FormField
              control={form.control}
              name="signingOrder"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-x-3 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="flex flex-col gap-y-0.5">
                    <FormLabel className="text-sm font-medium leading-none">
                      Enable signing order
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircleIcon className="ml-1 inline h-4 w-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs text-sm">
                            Recipients will be notified to sign in the order listed below.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </FormLabel>
                    <FormMessage />
                  </div>
                </FormItem>
              )}
            />

            <DragDropContext onDragEnd={handleDragEnd} sensors={[(api: any) => { sensorApiRef.current = api; }]}>
              <Droppable droppableId="recipients">
                {(provided: any) => (
                  <div
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    className="flex w-full flex-col gap-y-2"
                  >
                    {fields.map((field: any, index: number) => (
                      <Draggable
                        key={`${field.id}-${field.signingOrder}`}
                        draggableId={field.id}
                        index={index}
                        isDragDisabled={
                          !watchSigningOrder ||
                          form.formState.isSubmitting ||
                          !canRecipientBeEdited(field.nativeId)
                        }
                      >
                        {(dragProvided: any, snapshot: any) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            className={cn('rounded-lg border bg-card p-3', {
                              'shadow-lg ring-2 ring-primary': snapshot.isDragging,
                            })}
                          >
                            <div className="flex items-start gap-x-2">
                              {watchSigningOrder && (
                                <div
                                  {...dragProvided.dragHandleProps}
                                  className="mt-2.5 cursor-grab text-muted-foreground active:cursor-grabbing"
                                >
                                  <GripIcon className="h-5 w-5" />
                                </div>
                              )}

                              <div className="grid flex-1 grid-cols-2 gap-2">
                                <FormField
                                  control={form.control}
                                  name={`recipients.${index}.name`}
                                  render={({ field: nameField }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Name</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...nameField}
                                          placeholder="Jane Doe"
                                          disabled={
                                            form.formState.isSubmitting ||
                                            !canRecipientBeEdited(field.nativeId)
                                          }
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />

                                <FormField
                                  control={form.control}
                                  name={`recipients.${index}.email`}
                                  render={({ field: emailField }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Email</FormLabel>
                                      <FormControl>
                                        <Input
                                          {...emailField}
                                          type="email"
                                          placeholder="jane@example.com"
                                          disabled={
                                            form.formState.isSubmitting ||
                                            !canRecipientBeEdited(field.nativeId)
                                          }
                                        />
                                      </FormControl>
                                      <FormMessage />
                                    </FormItem>
                                  )}
                                />
                              </div>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="mt-1.5 shrink-0 text-destructive hover:text-destructive"
                                disabled={
                                  form.formState.isSubmitting ||
                                  fields.length <= 1 ||
                                  !canRecipientBeEdited(field.nativeId)
                                }
                                onClick={() => handleRemoveRecipient(index)}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}

                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={form.formState.isSubmitting}
              onClick={handleAddRecipient}
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add recipient
            </Button>
          </form>
        </Form>
      </div>

      <div className="flex items-center justify-between border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={form.formState.isSubmitting}>
          Back
        </Button>

        <div className="flex items-center gap-x-2">
          <span className="text-sm text-muted-foreground">
            Step {flowStep.stepIndex} of {flowStep.totalSteps}
          </span>

          <Button
            type="submit"
            form={formId}
            disabled={form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
