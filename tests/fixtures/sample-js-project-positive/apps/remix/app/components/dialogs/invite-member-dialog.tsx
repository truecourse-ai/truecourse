
// FP shape: component body with standard useState/useRef hook calls
declare function useRef<T>(v: T | null): { current: T | null };
declare function useState<T>(init: T): [T, (v: T) => void];

type InviteMemberDialogProps = {
  trigger?: React.ReactNode;
};

export const InviteMemberDialog = ({ trigger }: InviteMemberDialogProps) => {
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [invitationType, setInvitationType] = useState<'INDIVIDUAL' | 'BULK'>('INDIVIDUAL');

  const { _ } = useLingui();
  const { toast } = useToast();

  return null;
};



// --- too-many-lines shape: large React TSX component with hooks, tabs, and JSX form structure ---
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useRef<T>(v: T | null): { current: T | null };
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare function useFieldArray(opts: { control: unknown; name: string }): { fields: { id: string }[]; append: (v: unknown) => void; remove: (i: number) => void };
declare function useForm<T>(opts?: unknown): { control: unknown; handleSubmit: (fn: (v: T) => void) => (e: unknown) => void; formState: { isSubmitting: boolean } };
declare function useToast(): { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare function useLingui(): { _: (msg: unknown) => string };
declare const msg: (s: TemplateStringsArray, ...v: unknown[]) => unknown;
declare const cn: (...args: unknown[]) => string;
declare const z: { object: (s: unknown) => unknown; string: () => { email: () => unknown; min: (n: number, opts: unknown) => unknown }; enum: (v: readonly string[]) => unknown; array: (s: unknown) => { min: (n: number, opts: unknown) => unknown } };
declare const zodResolver: (schema: unknown) => unknown;
declare function PlusCircleIcon(props: { size?: number; className?: string }): JSX.Element;
declare function TrashIcon(props: { size?: number; className?: string }): JSX.Element;
declare function MailIcon(props: { size?: number; className?: string }): JSX.Element;
declare function UsersIcon(props: { size?: number; className?: string }): JSX.Element;
declare function UploadIcon(props: { size?: number; className?: string }): JSX.Element;
declare function DownloadIcon(props: { size?: number; className?: string }): JSX.Element;
declare function Dialog(props: { open?: boolean; onOpenChange?: (o: boolean) => void; children?: React.ReactNode }): JSX.Element;
declare function DialogTrigger(props: { asChild?: boolean; children?: React.ReactNode }): JSX.Element;
declare function DialogContent(props: { className?: string; children?: React.ReactNode }): JSX.Element;
declare function DialogHeader(props: { children?: React.ReactNode }): JSX.Element;
declare function DialogFooter(props: { children?: React.ReactNode }): JSX.Element;
declare function DialogTitle(props: { children?: React.ReactNode }): JSX.Element;
declare function DialogDescription(props: { children?: React.ReactNode }): JSX.Element;
declare function Tabs(props: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }): JSX.Element;
declare function TabsList(props: { className?: string; children?: React.ReactNode }): JSX.Element;
declare function TabsTrigger(props: { value: string; className?: string; children?: React.ReactNode }): JSX.Element;
declare function TabsContent(props: { value: string; children?: React.ReactNode }): JSX.Element;
declare function Form(props: { [key: string]: unknown; children?: React.ReactNode }): JSX.Element;
declare function FormField(props: { control: unknown; name: string; render: (opts: { field: unknown }) => JSX.Element }): JSX.Element;
declare function FormItem(props: { className?: string; children?: React.ReactNode }): JSX.Element;
declare function FormLabel(props: { required?: boolean; children?: React.ReactNode }): JSX.Element;
declare function FormControl(props: { children?: React.ReactNode }): JSX.Element;
declare function FormMessage(props?: {}): JSX.Element;
declare function Input(props: { className?: string; [key: string]: unknown }): JSX.Element;
declare function Button(props: { type?: string; variant?: string; size?: string; className?: string; onClick?: () => void; disabled?: boolean; children?: React.ReactNode }): JSX.Element;
declare function Select(props: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }): JSX.Element;
declare function SelectTrigger(props: { className?: string; children?: React.ReactNode }): JSX.Element;
declare function SelectValue(props: { placeholder?: string }): JSX.Element;
declare function SelectContent(props: { children?: React.ReactNode }): JSX.Element;
declare function SelectItem(props: { value: string; children?: React.ReactNode }): JSX.Element;
declare function Alert(props: { variant?: string; className?: string; children?: React.ReactNode }): JSX.Element;
declare function AlertDescription(props: { children?: React.ReactNode }): JSX.Element;
declare function SpinnerBox(props?: {}): JSX.Element;
declare function Trans(props: { children?: React.ReactNode }): JSX.Element;
declare const trpc: { workspace: { inviteMembers: { useMutation: (opts: { onSuccess?: () => void; onError?: (e: { message: string }) => void }) => { mutateAsync: (v: unknown) => Promise<void> } } }; billing: { getSeats: { useQuery: (opts?: unknown) => { data?: { used: number; total: number } | null; isLoading: boolean } } } };
declare function useCurrentWorkspace(): { workspaceId: string; workspaceName: string; memberRole: string };
declare const WORKSPACE_MEMBER_ROLE_MAP: Record<string, string>;
declare function parseCSV(file: File): Promise<{ email: string; role: string }[]>;
declare function downloadTemplate(): void;

type WorkspaceMemberInviteTabType = 'INDIVIDUAL' | 'BULK';

type WorkspaceMemberInviteDialogProps = {
  trigger?: React.ReactNode;
};

export const WorkspaceMemberInviteDialog = ({ trigger }: WorkspaceMemberInviteDialogProps) => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceMemberInviteTabType>('INDIVIDUAL');
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkParseError, setBulkParseError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { _ } = useLingui();
  const { toast } = useToast();
  const workspace = useCurrentWorkspace();

  const { data: seatsData, isLoading: seatsLoading } = trpc.billing.getSeats.useQuery(
    { workspaceId: workspace.workspaceId },
    { enabled: open },
  );

  const remainingSeats = useMemo(() => {
    if (!seatsData) return null;
    return seatsData.total - seatsData.used;
  }, [seatsData]);

  const form = useForm<{ invitations: { email: string; role: string }[] }>({
    resolver: zodResolver(
      z.object({
        invitations: z
          .array(
            z.object({
              email: z.string().email({ message: 'Invalid email' }).min(1, { message: 'Required' }),
              role: z.enum(['MEMBER', 'ADMIN', 'OWNER'] as const),
            }),
          )
          .min(1, { message: 'Add at least one invitation' }),
      }),
    ),
    defaultValues: {
      invitations: [{ email: '', role: 'MEMBER' }],
    },
  });

  const { fields: inviteFields, append: appendInvite, remove: removeInvite } = useFieldArray({
    control: form.control,
    name: 'invitations',
  });

  const { mutateAsync: inviteMembers } = trpc.workspace.inviteMembers.useMutation({
    onSuccess: () => {
      toast({ title: 'Invitations sent', description: 'Members have been invited to the workspace.' });
      setOpen(false);
    },
    onError: (error) => {
      toast({ title: 'Failed to send invitations', description: error.message, variant: 'destructive' });
    },
  });

  const onFormSubmit = async (values: { invitations: { email: string; role: string }[] }) => {
    await inviteMembers({ workspaceId: workspace.workspaceId, invitations: values.invitations });
  };

  const onBulkFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkParseError(null);
  };

  const onBulkSubmit = async () => {
    if (!bulkFile) return;
    setIsUploading(true);
    try {
      const rows = await parseCSV(bulkFile);
      await inviteMembers({ workspaceId: workspace.workspaceId, invitations: rows });
    } catch (err: unknown) {
      const msg2 = err instanceof Error ? err.message : 'Parse error';
      setBulkParseError(msg2);
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setBulkFile(null);
      setBulkParseError(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Invite workspace members</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>Invite colleagues to collaborate in {workspace.workspaceName}.</Trans>
          </DialogDescription>
        </DialogHeader>

        {seatsLoading ? (
          <SpinnerBox />
        ) : (
          <>
            {remainingSeats !== null && remainingSeats <= 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <Trans>
                    Your workspace has no remaining seats. Upgrade your plan to invite more members.
                  </Trans>
                </AlertDescription>
              </Alert>
            )}

            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as WorkspaceMemberInviteTabType)}
            >
              <TabsList className="w-full">
                <TabsTrigger value="INDIVIDUAL" className="w-full hover:text-foreground">
                  <MailIcon size={20} className="mr-2" />
                  <Trans>Invite members</Trans>
                </TabsTrigger>

                <TabsTrigger value="BULK" className="w-full hover:text-foreground">
                  <UsersIcon size={20} className="mr-2" />
                  <Trans>Bulk import</Trans>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="INDIVIDUAL">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onFormSubmit)}>
                    <fieldset
                      className="flex h-full flex-col space-y-4"
                      disabled={form.formState.isSubmitting}
                    >
                      <div className="custom-scrollbar max-h-[60vh] space-y-4 overflow-y-auto p-1">
                        {inviteFields.map((inviteField, index) => (
                          <div
                            className="flex w-full flex-row space-x-4"
                            key={inviteField.id}
                          >
                            <FormField
                              control={form.control}
                              name={`invitations.${index}.email`}
                              render={({ field }) => (
                                <FormItem className="w-full">
                                  {index === 0 && (
                                    <FormLabel required>
                                      <Trans>Email address</Trans>
                                    </FormLabel>
                                  )}
                                  <FormControl>
                                    <Input className="bg-background" {...(field as object)} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={`invitations.${index}.role`}
                              render={({ field }) => (
                                <FormItem>
                                  {index === 0 && (
                                    <FormLabel>
                                      <Trans>Role</Trans>
                                    </FormLabel>
                                  )}
                                  <FormControl>
                                    <Select
                                      value={(field as { value: string }).value}
                                      onValueChange={(field as { onChange: (v: string) => void }).onChange}
                                    >
                                      <SelectTrigger className="w-36">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {Object.entries(WORKSPACE_MEMBER_ROLE_MAP).map(([role, label]) => (
                                          <SelectItem key={role} value={role}>
                                            {label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="flex items-end pb-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                disabled={inviteFields.length === 1}
                                onClick={() => removeInvite(index)}
                              >
                                <TrashIcon size={16} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => appendInvite({ email: '', role: 'MEMBER' })}
                      >
                        <PlusCircleIcon size={16} className="mr-2" />
                        <Trans>Add another</Trans>
                      </Button>

                      <DialogFooter>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                          <Trans>Send invitations</Trans>
                        </Button>
                      </DialogFooter>
                    </fieldset>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="BULK">
                <div className="flex flex-col space-y-4">
                  <p className="text-muted-foreground text-sm">
                    <Trans>
                      Upload a CSV file with columns: <strong>email</strong>, <strong>role</strong>.
                    </Trans>
                  </p>

                  <div className="flex items-center space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon size={16} className="mr-2" />
                      <Trans>Choose file</Trans>
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={downloadTemplate}
                    >
                      <DownloadIcon size={16} className="mr-2" />
                      <Trans>Download template</Trans>
                    </Button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={onBulkFileChange}
                    />
                  </div>

                  {bulkFile && (
                    <p className="text-sm">
                      <Trans>Selected: {bulkFile.name}</Trans>
                    </p>
                  )}

                  {bulkParseError && (
                    <Alert variant="destructive">
                      <AlertDescription>{bulkParseError}</AlertDescription>
                    </Alert>
                  )}

                  <DialogFooter>
                    <Button
                      type="button"
                      disabled={!bulkFile || isUploading}
                      onClick={onBulkSubmit}
                    >
                      <Trans>Import members</Trans>
                    </Button>
                  </DialogFooter>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};



// FP shape: EXTENDED_MEMBER_ROLE_MAP is a Record keyed by MemberRole enum;
// role comes from iterating MEMBER_ROLE_HIERARCHY[...] which yields only valid role values.
// Enum-exhaustive Record lookup.
declare const enum GroupMemberRole { OWNER = 'OWNER', ADMIN = 'ADMIN', MEMBER = 'MEMBER' }

const GROUP_MEMBER_ROLE_LABELS = {
  [GroupMemberRole.OWNER]: { label: 'Owner', sortOrder: 1, canManage: true },
  [GroupMemberRole.ADMIN]: { label: 'Admin', sortOrder: 2, canManage: true },
  [GroupMemberRole.MEMBER]: { label: 'Member', sortOrder: 3, canManage: false },
} satisfies Record<GroupMemberRole, { label: string; sortOrder: number; canManage: boolean }>;

const GROUP_ROLE_HIERARCHY: GroupMemberRole[] = [GroupMemberRole.OWNER, GroupMemberRole.ADMIN, GroupMemberRole.MEMBER];

function buildRoleOptions() {
  return GROUP_ROLE_HIERARCHY.map((role) => ({
    value: role,
    ...GROUP_MEMBER_ROLE_LABELS[role],
  }));
}
