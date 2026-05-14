
// FP shape: component body starting with standard hook calls
declare function useSession(): { user: { id: string; email: string } };
declare function useCurrentTeam(): { id: number; url: string } | null;

type ResendDialogProps = {
  documentId: string;
  recipientIds: string[];
};

export const ResendDialog = ({ documentId, recipientIds }: ResendDialogProps) => {
  const { user } = useSession();
  const team = useCurrentTeam();
  const { _ } = useLingui();
  const { toast } = useToast();

  return null;
};



// FP shape: TSX React component whose body exceeds 50 lines due to hooks + JSX markup
// The line count comes from standard React framework structure (hooks, form, dialog JSX),
// not from decomposable excess logic.
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useForm<T>(opts: object): { handleSubmit: (fn: (v: T) => void) => (e: unknown) => void; control: unknown; formState: { isSubmitting: boolean } };
declare function useWatch<T>(opts: { control: unknown; name: string }): T;
declare function useToast(): { toast: (opts: { title: string; description: string; variant?: string; duration?: number }) => void };
declare function useLingui(): { _: (m: unknown) => string };
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): unknown;
declare function zodResolver(schema: unknown): unknown;
declare const z: { object: (s: object) => unknown; array: (s: unknown) => { min: (n: number, opts: object) => unknown }; number: () => unknown; infer: unknown };
declare const cn: (...args: unknown[]) => string;

type NotificationRecipient = { id: number; email: string; deliveryStatus: string };
type NotifyDocumentDialogProps = {
  documentId: number;
  ownerId: number;
  teamUrl: string | null;
  documentStatus: string;
  recipients: NotificationRecipient[];
};

const NOTIFY_FORM_ID = 'notify-document-form';

export const NotifyDocumentDialog = ({
  documentId,
  ownerId,
  teamUrl,
  documentStatus,
  recipients,
}: NotifyDocumentDialogProps) => {
  const { user } = useSession();
  const team = useCurrentTeam();
  const { toast } = useToast();
  const { _ } = useLingui();

  const [isOpen, setIsOpen] = useState(false);
  const isOwner = ownerId === user.id;
  const isTeamDoc = team && teamUrl === team.url;

  const isDisabled =
    (!isOwner && !isTeamDoc) ||
    documentStatus !== 'PENDING' ||
    !recipients.some((r) => r.deliveryStatus === 'PENDING');

  const { mutateAsync: notifyRecipients } = trpc.document.notify.useMutation();

  const form = useForm<{ recipientIds: number[] }>({
    resolver: zodResolver(
      z.object({ recipientIds: z.array(z.number()).min(1, { message: 'Select at least one recipient.' }) }),
    ),
    defaultValues: { recipientIds: [] },
  });

  const { handleSubmit, formState: { isSubmitting } } = form;

  const selectedIds = useWatch<number[]>({ control: form.control, name: 'recipientIds' });

  const onSubmit = async ({ recipientIds }: { recipientIds: number[] }) => {
    try {
      await notifyRecipients({ documentId, recipientIds });
      toast({
        title: _(msg`Notification sent`),
        description: _(msg`Recipients have been notified successfully.`),
        duration: 5000,
      });
      setIsOpen(false);
    } catch {
      toast({
        title: _(msg`Something went wrong`),
        description: _(msg`Could not send notifications. Please try again.`),
        variant: 'destructive',
        duration: 7500,
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <DropdownMenuItem disabled={isDisabled} onSelect={(e: Event) => e.preventDefault()}>
          <BellIcon className="mr-2 h-4 w-4" />
          <span>Notify</span>
        </DropdownMenuItem>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" hideClose>
        <DialogHeader>
          <DialogTitle asChild>
            <h1 className="text-center text-xl">Who should be notified?</h1>
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form id={NOTIFY_FORM_ID} onSubmit={handleSubmit(onSubmit)} className="px-4 py-2">
            <FormField
              control={form.control}
              name="recipientIds"
              render={({ field: { value, onChange } }) => (
                <>
                  {recipients.map((recipient) => (
                    <FormItem
                      key={recipient.id}
                      className="flex flex-row items-center justify-between gap-x-3 py-1"
                    >
                      <FormLabel
                        className={cn('flex items-center gap-2 font-normal', {
                          'opacity-40': !value.includes(recipient.id),
                        })}
                      >
                        <Avatar fallback={recipient.email[0].toUpperCase()} />
                        {recipient.email}
                      </FormLabel>
                      <FormControl>
                        <Checkbox
                          className="h-5 w-5 rounded-full"
                          value={recipient.id}
                          checked={value.includes(recipient.id)}
                          onCheckedChange={(checked: boolean) =>
                            checked
                              ? onChange([...value, recipient.id])
                              : onChange(value.filter((v: number) => v !== recipient.id))
                          }
                        />
                      </FormControl>
                    </FormItem>
                  ))}
                </>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <div className="flex w-full gap-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              form={NOTIFY_FORM_ID}
              className="flex-1"
              loading={isSubmitting}
              disabled={isSubmitting || selectedIds.length === 0}
            >
              Send
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
