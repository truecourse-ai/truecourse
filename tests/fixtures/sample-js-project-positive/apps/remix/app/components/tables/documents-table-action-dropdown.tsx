
declare const useSession6: () => { user: { id: string; email: string } };
declare const useCurrentTeam3: () => { url?: string; teamEmail?: { email: string } | null };
declare const useLingui8: () => { _: (msg: unknown) => string };
declare const trpcReact2: { useUtils: () => unknown };
declare const useState10: <T>(v: T) => [T, (v: T) => void];
declare const findRecipientByEmail2: (opts: { recipients: unknown[]; userEmail: string; teamEmail?: string }) => { role: string; token: string; signingStatus: string } | undefined;
declare const isDocumentCompleted2: (status: string) => boolean;
declare const getEnvelopeItemPermissions2: (envelope: unknown, items: unknown[]) => { canTitleBeChanged: boolean };
declare const formatDocumentsPath2: (teamUrl?: string) => string;
declare const DocumentStatus3: { DRAFT: string; PENDING: string };
declare const RecipientRole3: { CC: string; ASSISTANT: string; VIEWER: string; SIGNER: string };
declare const EnvelopeType3: { DOCUMENT: string };
declare const SigningStatus3: { SIGNED: string };
declare const DropdownMenu6: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuTrigger6: React.FC<{ 'data-testid'?: string; children?: React.ReactNode }>;
declare const DropdownMenuContent6: React.FC<{ className?: string; align?: string; forceMount?: boolean; children?: React.ReactNode }>;
declare const DropdownMenuLabel6: React.FC<{ children?: React.ReactNode }>;
declare const DropdownMenuItem6: React.FC<{ disabled?: boolean; asChild?: boolean; children?: React.ReactNode }>;
declare const MoreHorizontal6: React.FC<{ className?: string }>;
declare const EyeIcon2: React.FC<{ className?: string }>;
declare const Pencil2: React.FC<{ className?: string }>;
declare const Link7: React.FC<{ to: string; children?: React.ReactNode }>;
declare const EnvelopeRenameDialog2: React.FC<{ open: boolean; onOpenChange: (v: boolean) => void; envelopeId: string }>;
declare const Trans4: React.FC<{ children?: React.ReactNode }>;
declare const React: { FC: unknown; ReactNode: unknown };

type TDocumentRow2 = {
  id: string;
  envelopeId: string;
  status: string;
  completedAt?: Date | null;
  deletedAt?: Date | null;
  user: { id: string; email: string };
  recipients: Array<{ email: string; role: string; signingStatus: string; token: string }>;
  team?: { url: string } | null;
};

export const DocumentsTableActionDropdown2 = ({ row, onMoveDocument }: { row: TDocumentRow2; onMoveDocument?: () => void }) => {
  const { user } = useSession6();
  const team = useCurrentTeam3();
  const { _ } = useLingui8();
  const trpcUtils = trpcReact2.useUtils();

  const [isRenameDialogOpen, setRenameDialogOpen] = useState10(false);
  const [isSaveAsTemplateDialogOpen, setSaveAsTemplateDialogOpen] = useState10(false);

  const recipient = findRecipientByEmail2({
    recipients: row.recipients,
    userEmail: user.email,
    teamEmail: team.teamEmail?.email,
  });

  const isOwner = row.user.id === user.id;
  const isDraft = row.status === DocumentStatus3.DRAFT;
  const isPending = row.status === DocumentStatus3.PENDING;
  const isComplete = isDocumentCompleted2(row.status);
  const isCurrentTeamDocument = team && row.team?.url === team.url;
  const canManageDocument = Boolean(isOwner || isCurrentTeamDocument);

  const { canTitleBeChanged } = getEnvelopeItemPermissions2(
    {
      completedAt: row.completedAt,
      deletedAt: row.deletedAt,
      type: EnvelopeType3.DOCUMENT,
      status: row.status,
    },
    [],
  );

  const documentsPath = formatDocumentsPath2(team.url);
  const formatPath = `${documentsPath}/${row.envelopeId}/edit`;

  const nonSignedRecipients = row.recipients.filter((item) => item.signingStatus !== SigningStatus3.SIGNED);

  return (
    <DropdownMenu6>
      <DropdownMenuTrigger6 data-testid="document-table-action-btn">
        <MoreHorizontal6 className="h-5 w-5 text-muted-foreground" />
      </DropdownMenuTrigger6>

      <DropdownMenuContent6 className="w-52" align="start" forceMount>
        <DropdownMenuLabel6>
          <Trans4>Action</Trans4>
        </DropdownMenuLabel6>

        {!isDraft && recipient && recipient.role !== RecipientRole3.CC && recipient.role !== RecipientRole3.ASSISTANT && (
          <DropdownMenuItem6 disabled={!recipient || isComplete} asChild>
            <Link7 to={`/sign/${recipient.token}`}>
              {recipient.role === RecipientRole3.VIEWER && (
                <>
                  <EyeIcon2 className="mr-2 h-4 w-4" />
                  <Trans4>View</Trans4>
                </>
              )}
              {recipient.role === RecipientRole3.SIGNER && (
                <>
                  <Pencil2 className="mr-2 h-4 w-4" />
                  <Trans4>Sign</Trans4>
                </>
              )}
            </Link7>
          </DropdownMenuItem6>
        )}

        {canManageDocument && canTitleBeChanged && (
          <DropdownMenuItem6 onClick={() => setRenameDialogOpen(true)}>
            <Trans4>Rename</Trans4>
          </DropdownMenuItem6>
        )}
      </DropdownMenuContent6>

      <EnvelopeRenameDialog2
        open={isRenameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        envelopeId={row.envelopeId}
      />
    </DropdownMenu6>
  );
};
