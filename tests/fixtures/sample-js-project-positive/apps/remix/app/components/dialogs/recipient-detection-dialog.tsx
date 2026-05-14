
// FP shape: React component destructured parameter list with multiple props
declare function useState<T>(init: T): [T, (v: T) => void];

type RecipientDetectionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (recipients: Array<{ name: string; email: string; role: string }>) => void;
  envelopeId: string;
  teamId: number;
};

export const RecipientDetectionDialog = ({
  open,
  onOpenChange,
  onComplete,
  envelopeId,
  teamId,
}: RecipientDetectionDialogProps) => {
  const [state, setState] = useState<'PROMPT' | 'PROCESSING' | 'DONE'>('PROMPT');
  return null;
};



// FP shape: roleValueByLabel is a Record typed with RoleLabel as the key type;
// roleLabel is the same parameter typed to that union. The lookup is exhaustive by construction.
type RoleLabel = 'Viewer' | 'Signer' | 'Approver' | 'CC';
type RoleValue = 'VIEWER' | 'SIGNER' | 'APPROVER' | 'CC';

const ROLE_VALUE_BY_LABEL: Record<RoleLabel, RoleValue> = {
  Viewer: 'VIEWER',
  Signer: 'SIGNER',
  Approver: 'APPROVER',
  CC: 'CC',
};

function resolveRoleFromLabel(roleLabel: RoleLabel): RoleValue {
  return ROLE_VALUE_BY_LABEL[roleLabel];
}
