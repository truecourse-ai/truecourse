
// FF20 — form.handleSubmit(onSubmit) standard react-hook-form pattern
type FormValues = { email: string; role: string };
declare const form: {
  handleSubmit: (onValid: (data: FormValues) => Promise<void>) => (e: Event) => void;
  formState: { isSubmitting: boolean };
};
declare function inviteMember(data: FormValues): Promise<void>;

async function onSubmit(data: FormValues) {
  await inviteMember(data);
}

const submitHandler = form.handleSubmit(onSubmit);



// --- argument-type-mismatch FP: enum array mapped to SelectItem value props ---
declare function SelectItem(props: { value: string; children?: React.ReactNode }): JSX.Element;

enum MemberRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

const ROLE_HIERARCHY: Record<MemberRole, MemberRole[]> = {
  [MemberRole.OWNER]: [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.VIEWER],
  [MemberRole.ADMIN]: [MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.VIEWER],
  [MemberRole.MEMBER]: [MemberRole.MEMBER, MemberRole.VIEWER],
  [MemberRole.VIEWER]: [MemberRole.VIEWER],
};

function RoleSelectOptions({ currentRole }: { currentRole: MemberRole }) {
  return (
    <div>
      {ROLE_HIERARCHY[currentRole].map((role) => (
        <SelectItem key={role} value={role}>
          {role}
        </SelectItem>
      ))}
    </div>
  );
}
