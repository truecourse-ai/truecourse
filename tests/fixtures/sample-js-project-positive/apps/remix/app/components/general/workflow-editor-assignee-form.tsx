// --- too-many-lines shape: react-tsx-component (JSX markup and hooks inflate line count; standard React framework structure) ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;
declare function useEffect(fn: () => void | (() => void), deps?: any[]): void;
declare function useMemo<T>(fn: () => T, deps: any[]): T;
declare function useRef<T>(init: T): { current: T };
declare function useFieldArray(opts: { name: string }): { fields: any[]; append: (v: any) => void; remove: (i: number) => void };
declare function useWatch(opts: { name: string }): any;
declare function useRevalidator(): { revalidate: () => void };
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];
declare function useCurrentWorkflowEditor(): {
  workflow: any;
  setAssigneesDebounced: (v: any) => void;
  updateWorkflow: (v: any) => void;
  editorAssignees: any[];
  isEmbedded: boolean;
  editorConfig: any;
};
declare function useCurrentOrganisation(): any;
declare function useCurrentTeam(): any;
declare function useLimits(): { remaining: number };
declare function useOptionalSession(): { sessionData: { user: any } | null };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useDebouncedValue<T>(val: T, ms: number): T;
declare const nanoid: () => string;
declare function cn(...classes: (string | boolean | undefined | null)[]): string;
declare const motion: { fieldset: any };
declare function canAssigneeBeModified(id: string): boolean;
declare const WorkflowType: { TEMPLATE: string };
declare const AssigneeRole: { APPROVER: string; REVIEWER: string; SIGNER: string };
declare const SendStatus: { SENT: string; PENDING: string };
declare const WorkflowSigningOrder: { SEQUENTIAL: string; PARALLEL: string };
declare const GripVerticalIcon: any;
declare const HelpCircleIcon: any;
declare const PlusIcon: any;
declare const TrashIcon: any;
declare const SparklesIcon: any;
declare const DragDropContext: any;
declare const Droppable: any;
declare const Draggable: any;
declare const Form: any;
declare const FormControl: any;
declare const FormField: any;
declare const FormItem: any;
declare const FormLabel: any;
declare const FormMessage: any;
declare const FormErrorMessage: any;
declare const Input: any;
declare const Button: any;
declare const Card: any;
declare const CardContent: any;
declare const CardHeader: any;
declare const CardTitle: any;
declare const CardDescription: any;
declare const Checkbox: any;
declare const Tooltip: any;
declare const TooltipContent: any;
declare const TooltipTrigger: any;
declare const AssigneeAutoCompleteInput: any;
declare const AssigneeRoleSelect: any;
declare const AssigneeActionAuthSelect: any;
declare const SigningOrderConfirmation: any;
declare const AiFeaturesEnableDialog: any;
declare const AiAssigneeDetectionDialog: any;
declare const Trans: any;

export const WorkflowEditorAssigneeForm = () => {
  const { workflow, setAssigneesDebounced, updateWorkflow, editorAssignees, isEmbedded, editorConfig } =
    useCurrentWorkflowEditor();

  const organisation = useCurrentOrganisation();
  const team = useCurrentTeam();
  const { remaining } = useLimits();
  const { sessionData } = useOptionalSession();
  const { toast } = useToast();

  const user = sessionData?.user;

  const [searchParams, setSearchParams] = useSearchParams();
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('');
  const [isAiEnableDialogOpen, setIsAiEnableDialogOpen] = useState(false);
  const [isAiDetectionDialogOpen, setIsAiDetectionDialogOpen] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const revalidator = useRevalidator();

  const form = { control: null as any, handleSubmit: (fn: any) => (e: any) => {}, getValues: () => ({} as any) };
  const { fields: assignees, append: appendAssignee, remove: removeAssignee } = useFieldArray({ name: 'assignees' });
  const watchedAssignees = useWatch({ name: 'assignees' });

  const isSigningOrderSequential = workflow?.signingOrder === WorkflowSigningOrder.SEQUENTIAL;
  const maxAssignees = remaining ?? 0;

  const canAddAssignee = useMemo(() => {
    const current = watchedAssignees?.length ?? 0;
    return current < maxAssignees && !isEmbedded;
  }, [watchedAssignees, maxAssignees, isEmbedded]);

  const debouncedQuery = useDebouncedValue(assigneeSearchQuery, 300);

  const canAssigneeBeModifiedLocal = useCallback(
    (id: string) => canAssigneeBeModified(id),
    [workflow]
  );

  useEffect(() => {
    const current = form.getValues();
    if (!current) return;
    setAssigneesDebounced(current);
  }, [watchedAssignees]);

  useEffect(() => {
    const advParam = searchParams.get('advanced');
    if (advParam === '1') setShowAdvancedSettings(true);
  }, [searchParams]);

  const handleDragEnd = useCallback(
    (result: { source: { index: number }; destination?: { index: number } | null }) => {
      if (!result.destination) return;
      const { source, destination } = result;
      if (source.index === destination.index) return;
      const current = form.getValues() as any;
      const updated = [...(current.assignees ?? [])];
      const [moved] = updated.splice(source.index, 1);
      updated.splice(destination.index, 0, moved);
      const reordered = updated.map((a: any, idx: number) => ({ ...a, signingOrder: idx + 1 }));
      updateWorkflow({ assignees: reordered });
    },
    [form, updateWorkflow]
  );

  const handleAddAssignee = useCallback(() => {
    if (!canAddAssignee) {
      toast({ title: 'Limit reached', description: 'Upgrade to add more assignees.', variant: 'destructive' });
      return;
    }
    appendAssignee({
      nativeId: nanoid(),
      name: '',
      email: '',
      role: AssigneeRole.SIGNER,
      signingOrder: (watchedAssignees?.length ?? 0) + 1,
    });
  }, [canAddAssignee, appendAssignee, watchedAssignees, toast]);

  const handleRemoveAssignee = useCallback(
    (index: number) => {
      removeAssignee(index);
    },
    [removeAssignee]
  );

  const handleToggleSigningOrder = useCallback(
    (checked: boolean) => {
      updateWorkflow({
        signingOrder: checked ? WorkflowSigningOrder.SEQUENTIAL : WorkflowSigningOrder.PARALLEL,
      });
    },
    [updateWorkflow]
  );

  const handleAiDetect = useCallback(() => {
    if (!editorConfig?.aiEnabled) {
      setIsAiEnableDialogOpen(true);
      return;
    }
    setIsAiDetectionDialogOpen(true);
  }, [editorConfig]);

  const sensorRef = useRef<any>(null);

  const handleSensorApi = useCallback((api: any) => {
    sensorRef.current = api;
  }, []);

  if (!workflow) {
    return (
      <div className="flex items-center justify-center p-8">
        <span>Loading workflow...</span>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form className="flex w-full flex-col gap-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold">
              <Trans>Assignees</Trans>
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              <Trans>Add the people who need to act on this workflow.</Trans>
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-x-2">
                <Checkbox
                  id="signing-order"
                  checked={isSigningOrderSequential}
                  onCheckedChange={handleToggleSigningOrder}
                  disabled={isSubmitting}
                />
                <label htmlFor="signing-order" className="text-sm font-medium">
                  <Trans>Sequential signing</Trans>
                </label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircleIcon className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-sm">
                    <Trans>Assignees will be notified in order when sequential signing is enabled.</Trans>
                  </TooltipContent>
                </Tooltip>
              </div>
              {editorConfig?.aiEnabled !== undefined && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleAiDetect}
                  className="gap-x-1.5 text-xs"
                >
                  <SparklesIcon className="h-3.5 w-3.5" />
                  <Trans>Detect assignees</Trans>
                </Button>
              )}
            </div>
            <DragDropContext onDragEnd={handleDragEnd} sensors={[handleSensorApi]}>
              <Droppable droppableId="assignees">
                {(provided: any) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="flex w-full flex-col gap-y-2">
                    {assignees.map((assignee: any, index: number) => {
                      const isDirectAssignee =
                        workflow.type === WorkflowType.TEMPLATE &&
                        workflow.directLink !== null &&
                        assignee.id === workflow.directLink?.directTemplateAssigneeId;

                      return (
                        <Draggable
                          key={`${assignee.nativeId}-${assignee.signingOrder}`}
                          draggableId={assignee['nativeId']}
                          index={index}
                          isDragDisabled={
                            !isSigningOrderSequential ||
                            isSubmitting ||
                            !canAssigneeBeModifiedLocal(assignee.id) ||
                            !assignee.signingOrder
                          }
                        >
                          {(provided: any, snapshot: any) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={cn('py-1', {
                                'pointer-events-none rounded-md bg-widget-foreground pt-2': snapshot.isDragging,
                              })}
                            >
                              <motion.fieldset
                                data-native-id={assignee.id}
                                disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id)}
                                className={cn('pb-2', {
                                  'border-b pb-4': showAdvancedSettings && index !== assignees.length - 1,
                                  'pt-2': showAdvancedSettings && index === 0,
                                  'pr-3': isSigningOrderSequential,
                                })}
                              >
                                <div className="flex flex-row items-center gap-x-2">
                                  {isSigningOrderSequential && (
                                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                                      {assignee.signingOrder}
                                    </div>
                                  )}
                                  <div className="flex flex-1 flex-col gap-y-2">
                                    <FormField
                                      control={form.control}
                                      name={`assignees.${index}.email`}
                                      render={({ field }: any) => (
                                        <FormItem>
                                          <FormLabel className="sr-only">
                                            <Trans>Email</Trans>
                                          </FormLabel>
                                          <FormControl>
                                            <AssigneeAutoCompleteInput
                                              {...field}
                                              disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id) || isDirectAssignee}
                                              placeholder="Email address"
                                              searchQuery={debouncedQuery}
                                              onSearchQueryChange={setAssigneeSearchQuery}
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    <FormField
                                      control={form.control}
                                      name={`assignees.${index}.name`}
                                      render={({ field }: any) => (
                                        <FormItem>
                                          <FormLabel className="sr-only">
                                            <Trans>Name</Trans>
                                          </FormLabel>
                                          <FormControl>
                                            <Input
                                              {...field}
                                              disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id) || isDirectAssignee}
                                              placeholder="Full name"
                                            />
                                          </FormControl>
                                          <FormMessage />
                                        </FormItem>
                                      )}
                                    />
                                    {showAdvancedSettings && (
                                      <FormField
                                        control={form.control}
                                        name={`assignees.${index}.role`}
                                        render={({ field }: any) => (
                                          <FormItem>
                                            <FormLabel className="text-xs text-muted-foreground">
                                              <Trans>Role</Trans>
                                            </FormLabel>
                                            <FormControl>
                                              <AssigneeRoleSelect
                                                {...field}
                                                disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id) || isDirectAssignee}
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    )}
                                    {showAdvancedSettings && (
                                      <FormField
                                        control={form.control}
                                        name={`assignees.${index}.authOptions`}
                                        render={({ field }: any) => (
                                          <FormItem>
                                            <FormLabel className="text-xs text-muted-foreground">
                                              <Trans>Authentication</Trans>
                                            </FormLabel>
                                            <FormControl>
                                              <AssigneeActionAuthSelect
                                                {...field}
                                                disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id)}
                                              />
                                            </FormControl>
                                            <FormMessage />
                                          </FormItem>
                                        )}
                                      />
                                    )}
                                  </div>
                                  {isSigningOrderSequential && (
                                    <div className="flex shrink-0 cursor-grab items-center">
                                      <GripVerticalIcon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                  )}
                                  {!isDirectAssignee && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                                      disabled={isSubmitting || !canAssigneeBeModifiedLocal(assignee.id)}
                                      onClick={() => handleRemoveAssignee(index)}
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </motion.fieldset>
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
            <FormErrorMessage className="mt-2" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 w-full gap-x-2"
              disabled={!canAddAssignee || isSubmitting}
              onClick={handleAddAssignee}
            >
              <PlusIcon className="h-4 w-4" />
              <Trans>Add assignee</Trans>
            </Button>
          </CardContent>
        </Card>
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvancedSettings((v) => !v)}
          >
            {showAdvancedSettings ? <Trans>Hide advanced settings</Trans> : <Trans>Show advanced settings</Trans>}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <Trans>Continue</Trans>
          </Button>
        </div>
        {isSigningOrderSequential && (
          <SigningOrderConfirmation
            assignees={watchedAssignees ?? []}
            disabled={isSubmitting}
          />
        )}
      </form>
      <AiFeaturesEnableDialog open={isAiEnableDialogOpen} onOpenChange={setIsAiEnableDialogOpen} />
      <AiAssigneeDetectionDialog
        open={isAiDetectionDialogOpen}
        onOpenChange={setIsAiDetectionDialogOpen}
        workflowId={workflow?.id}
        onDetected={(detected: any[]) => {
          detected.forEach((d) => {
            appendAssignee({
              nativeId: nanoid(),
              name: d.name ?? '',
              email: d.email ?? '',
              role: d.role ?? AssigneeRole.SIGNER,
              signingOrder: (watchedAssignees?.length ?? 0) + 1,
            });
          });
          setIsAiDetectionDialogOpen(false);
        }}
      />
    </Form>
  );
};
