
declare const trpc3: { team: { group: { create: { useMutation: () => { mutateAsync: (opts: unknown) => Promise<void> } } } } };
declare const useCurrentTeam3: () => { id: number };
declare const useCurrentOrganisation3: () => { id: number; currentOrganisationRole: string };
declare const useToast4: () => { toast: (opts: { title: string; variant?: string }) => void };
declare const Dialog5: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; children?: React.ReactNode }>;
declare const DialogContent5: React.FC<{ children?: React.ReactNode }>;
declare const DialogHeader5: React.FC<{ children?: React.ReactNode }>;
declare const DialogTitle5: React.FC<{ children?: React.ReactNode }>;
declare const DialogDescription5: React.FC<{ children?: React.ReactNode }>;
declare const DialogFooter5: React.FC<{ children?: React.ReactNode }>;
declare const Button5: React.FC<{ type?: string; variant?: string; disabled?: boolean; onClick?: () => void; children?: React.ReactNode }>;
declare const Input5: React.FC<{ placeholder?: string; [key: string]: unknown }>;
declare const Label5: React.FC<{ children?: React.ReactNode; htmlFor?: string }>;
declare const useState5: <T>(v: T) => [T, (v: T) => void];
declare const useRef5: <T>(v: T | null) => { current: T | null };
declare const React: { FC: unknown; ReactNode: unknown };

type TeamGroupCreateDialogProps = {
  trigger?: React.ReactNode;
};

export const TeamGroupCreateDialog = ({ trigger, ...props }: TeamGroupCreateDialogProps & { open?: boolean; onOpenChange?: (v: boolean) => void }) => {
  const [open, setOpen] = useState5(props.open ?? false);
  const team = useCurrentTeam3();
  const { toast } = useToast4();

  const [groupName, setGroupName] = useState5('');
  const [isSubmitting, setIsSubmitting] = useState5(false);

  const { mutateAsync: createGroup } = trpc3.team.group.create.useMutation();

  const handleSubmit = async () => {
    if (!groupName.trim()) return;

    setIsSubmitting(true);
    try {
      await createGroup({ teamId: team.id, name: groupName.trim() });
      toast({ title: 'Group created' });
      setOpen(false);
      setGroupName('');
    } catch {
      toast({ title: 'Failed to create group', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog5 open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : null}

      <DialogContent5>
        <DialogHeader5>
          <DialogTitle5>Create group</DialogTitle5>
          <DialogDescription5>Create a new group for this team.</DialogDescription5>
        </DialogHeader5>

        <div className="flex flex-col gap-3">
          <Label5 htmlFor="group-name">Group name</Label5>
          <Input5
            id="group-name"
            placeholder="Engineering"
            value={groupName}
            onChange={(e) => setGroupName((e as React.ChangeEvent<HTMLInputElement>).target.value)}
          />
        </div>

        <DialogFooter5>
          <Button5 variant="secondary" onClick={() => setOpen(false)}>Cancel</Button5>
          <Button5 disabled={isSubmitting || !groupName.trim()} onClick={handleSubmit}>
            {isSubmitting ? 'Creating...' : 'Create'}
          </Button5>
        </DialogFooter5>
      </DialogContent5>
    </Dialog5>
  );
};



// FP shape: TEAM_MEMBER_ROLE_MAP is a Record keyed by TeamMemberRole enum;
// row.teamRole is cast to TeamMemberRole, and the map covers all enum values. Enum-exhaustive Record lookup.
declare const enum WorkspaceRole { OWNER = 'OWNER', EDITOR = 'EDITOR', VIEWER = 'VIEWER' }

const WORKSPACE_ROLE_CONFIG = {
  [WorkspaceRole.OWNER]: { label: 'Owner', canDelete: true, canInvite: true },
  [WorkspaceRole.EDITOR]: { label: 'Editor', canDelete: false, canInvite: true },
  [WorkspaceRole.VIEWER]: { label: 'Viewer', canDelete: false, canInvite: false },
} satisfies Record<WorkspaceRole, { label: string; canDelete: boolean; canInvite: boolean }>;

function getWorkspaceRoleConfig(role: WorkspaceRole) {
  return WORKSPACE_ROLE_CONFIG[role];
}

function buildMemberRow(member: { name: string; role: string }) {
  const role = member.role as WorkspaceRole;
  const config = WORKSPACE_ROLE_CONFIG[role];
  return { name: member.name, label: config.label, permissions: config };
}
