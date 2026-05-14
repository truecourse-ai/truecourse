
declare const trpc2: { admin: { workspace: { create: { useMutation: () => { mutateAsync: (opts: unknown) => Promise<{ workspaceId: string }> } } } } };
declare const useNavigate3: () => (path: string) => void;
declare const useToast3: () => { toast: (opts: { title: string; description?: string; variant?: string }) => void };
declare const Dialog3: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent3: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader3: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle3: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription3: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter3: React.FC<{ children?: React.ReactNode }>;
declare const Form3: React.FC<{ children?: React.ReactNode }>;
declare const FormField3: React.FC<{ control: unknown; name: string; render: (opts: { field: unknown }) => React.ReactNode }>;
declare const FormItem3: React.FC<{ children?: React.ReactNode }>;
declare const FormLabel3: React.FC<{ required?: boolean; children?: React.ReactNode }>;
declare const FormControl3: React.FC<{ children?: React.ReactNode }>;
declare const FormMessage3: React.FC<{ children?: React.ReactNode }>;
declare const Input3: React.FC<{ placeholder?: string; className?: string; value?: string; onChange?: (e: unknown) => void }>;
declare const Button3: React.FC<{ type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const useForm3: <T>(opts: unknown) => { handleSubmit: (fn: (data: T) => void) => React.FormEventHandler; control: unknown; formState: { isSubmitting: boolean } };
declare const zodResolver3: (schema: unknown) => unknown;
declare const z3: { object: (s: Record<string, unknown>) => unknown; string: () => { min: (n: number, opts?: unknown) => unknown } };
declare const useState3: <T>(v: T) => [T, (v: T) => void];
declare const React: { FC: unknown; ReactNode: unknown; FormEventHandler: unknown };

type AdminWorkspaceCreateDialogProps = {
  trigger?: React.ReactNode;
  ownerUserId: number;
};

const ZCreateWorkspaceFormSchema = z3.object({ name: z3.string().min(2, { message: 'Name is required' }) });
type TCreateWorkspaceFormSchema = { name: string };

export const AdminWorkspaceCreateDialog = ({ trigger, ownerUserId }: AdminWorkspaceCreateDialogProps) => {
  const navigate = useNavigate3();
  const { toast } = useToast3();

  const [open, setOpen] = useState3(false);

  const form = useForm3<TCreateWorkspaceFormSchema>({
    resolver: zodResolver3(ZCreateWorkspaceFormSchema),
    defaultValues: { name: '' },
  });

  const { mutateAsync: createWorkspace } = trpc2.admin.workspace.create.useMutation();

  const onFormSubmit = async ({ name }: TCreateWorkspaceFormSchema) => {
    try {
      const { workspaceId } = await createWorkspace({ ownerUserId, data: { name } });

      toast({ title: 'Workspace created' });
      navigate(`/admin/workspaces/${workspaceId}`);
      setOpen(false);
    } catch {
      toast({ title: 'Failed to create workspace', variant: 'destructive' });
    }
  };

  return (
    <Dialog3 open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : null}

      <DialogContent3>
        <DialogHeader3>
          <DialogTitle3>Create workspace</DialogTitle3>
          <DialogDescription3>Create a new workspace for the selected user.</DialogDescription3>
        </DialogHeader3>

        <Form3>
          <form onSubmit={form.handleSubmit(onFormSubmit)}>
            <fieldset disabled={form.formState.isSubmitting} className="flex flex-col space-y-4">
              <FormField3
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem3>
                    <FormLabel3 required>Workspace name</FormLabel3>
                    <FormControl3>
                      <Input3 placeholder="Acme Corp" {...(field as object)} />
                    </FormControl3>
                    <FormMessage3 />
                  </FormItem3>
                )}
              />

              <DialogFooter3>
                <Button3 type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button3>
                <Button3 type="submit" disabled={form.formState.isSubmitting}>Create</Button3>
              </DialogFooter3>
            </fieldset>
          </form>
        </Form3>
      </DialogContent3>
    </Dialog3>
  );
};



// FP shape: enum-exhaustive Record lookup — internalClaimsDescription keyed by PLAN_ID enum;
// planId comes from the same hardcoded enum values so the key is always present.
declare const enum PlanId { STARTER = 'STARTER', PRO = 'PRO', ENTERPRISE = 'ENTERPRISE' }

interface ClaimDescriptor { label: string; features: string[] }

const PLAN_CLAIM_DESCRIPTIONS: Record<PlanId, ClaimDescriptor> = {
  [PlanId.STARTER]: { label: 'Starter', features: ['5 docs/mo'] },
  [PlanId.PRO]: { label: 'Pro', features: ['100 docs/mo', 'API access'] },
  [PlanId.ENTERPRISE]: { label: 'Enterprise', features: ['Unlimited', 'SSO', 'SLA'] },
};

function getPlanClaimDescriptor(planId: PlanId): ClaimDescriptor {
  return PLAN_CLAIM_DESCRIPTIONS[planId];
}

const HARDCODED_PLAN_IDS: PlanId[] = [PlanId.STARTER, PlanId.PRO, PlanId.ENTERPRISE];

function buildPlanOptions() {
  return HARDCODED_PLAN_IDS.map((planId) => ({
    id: planId,
    descriptor: PLAN_CLAIM_DESCRIPTIONS[planId],
  }));
}



// FP shape: ORGANISATION_MEMBER_ROLE_MAP is a Record keyed by MemberRole enum;
// role is typed MemberRole at the call site — enum-exhaustive Record lookup.
declare const enum MemberRole { ADMIN = 'ADMIN', MANAGER = 'MANAGER', MEMBER = 'MEMBER' }

const MEMBER_ROLE_DISPLAY_MAP = {
  [MemberRole.ADMIN]: { label: 'Administrator', badge: 'red' },
  [MemberRole.MANAGER]: { label: 'Manager', badge: 'yellow' },
  [MemberRole.MEMBER]: { label: 'Member', badge: 'gray' },
} satisfies Record<MemberRole, { label: string; badge: string }>;

function getRoleDisplay(role: MemberRole) {
  return MEMBER_ROLE_DISPLAY_MAP[role];
}



// FP shape: planId is drawn from a hardcoded array of known plan IDs and plans is a typed Record keyed
// by exactly those IDs; no missing-key risk — this is a typed Record lookup, not an array index.
type InternalPlanId = 'INDIVIDUAL' | 'TEAM' | 'ENTERPRISE';

interface PlanDetails { name: string; maxSeats: number; price: number }

type InternalPlans = Record<InternalPlanId, PlanDetails>;

declare const availablePlans: InternalPlans;

const PLAN_IDS: InternalPlanId[] = ['INDIVIDUAL', 'TEAM', 'ENTERPRISE'];

function renderPlanCards(plans: InternalPlans) {
  return PLAN_IDS.map((planId) => ({
    id: planId,
    ...plans[planId],
  }));
}
