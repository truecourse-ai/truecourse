// Shared UI library primitives imported via scoped subpath — triggers cross-service-internal-import FP
// because the rule sees `@acme/ui/primitives/dialog` as a cross-service internal import,
// but `@acme/ui` is a cross-cutting shared UI library, not a bounded service with protected internals.

declare const React: { useState: <T>(v: T) => [T, (v: T) => void]; createElement: (...a: unknown[]) => unknown };
declare function Dialog(props: { open: boolean; onOpenChange: (v: boolean) => void; children: unknown }): JSX.Element;
declare function DialogContent(props: { children: unknown }): JSX.Element;
declare function DialogHeader(props: { children: unknown }): JSX.Element;
declare function DialogTitle(props: { children: unknown }): JSX.Element;
declare function DialogDescription(props: { children: unknown }): JSX.Element;
declare function DialogFooter(props: { children: unknown }): JSX.Element;
declare function Button(props: { type?: string; variant?: string; onClick?: () => void; children: unknown }): JSX.Element;
declare function Select(props: { value: string; onValueChange: (v: string) => void; children: unknown }): JSX.Element;
declare function SelectContent(props: { children: unknown }): JSX.Element;
declare function SelectItem(props: { value: string; children: unknown }): JSX.Element;
declare function SelectTrigger(props: { children: unknown }): JSX.Element;
declare function SelectValue(props: { placeholder?: string }): JSX.Element;

export type TeamMemberRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  currentRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  onRoleUpdated?: () => void;
};

export function TeamMemberRoleDialog({
  open,
  onOpenChange,
  memberId,
  currentRole,
  onRoleUpdated,
}: TeamMemberRoleDialogProps): JSX.Element {
  const [selectedRole, setSelectedRole] = React.useState<'OWNER' | 'ADMIN' | 'MEMBER'>(currentRole);
  const [isPending, setIsPending] = React.useState(false);

  const handleSubmit = async () => {
    setIsPending(true);
    try {
      // role update logic goes here
      onRoleUpdated?.();
      onOpenChange(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Team Member Role</DialogTitle>
          <DialogDescription>
            Change the role for this team member. Role changes take effect immediately.
          </DialogDescription>
        </DialogHeader>
        <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as typeof selectedRole)}>
          <SelectTrigger>
            <SelectValue placeholder="Select a role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OWNER">Owner</SelectItem>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="MEMBER">Member</SelectItem>
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" onClick={handleSubmit}>
            {isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}



// Shape: field.value.find((v) => ...) with optional chaining and fallback — type-safe, no mismatch
declare const roleField: { value: Array<{ groupId: string; role: string }> };
type MemberRole = 'ADMIN' | 'MEMBER' | 'VIEWER';

export function getGroupRole(groupId: string): MemberRole {
  return (roleField.value.find((v) => v.groupId === groupId)?.role as MemberRole) || 'MEMBER';
}
