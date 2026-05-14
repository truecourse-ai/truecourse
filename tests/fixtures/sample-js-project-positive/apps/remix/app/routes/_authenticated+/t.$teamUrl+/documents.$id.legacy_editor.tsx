// loader + LegacyContractEditorRoute — react-tsx FP shape
declare const getSessionUser_legacyEditor: (request: Request) => Promise<{ user: { id: number; email: string } }>;
declare const getContractById_legacyEditor: (opts: { id: { type: string; id: string }; userId: number; teamId: number }) => Promise<{
  id: number;
  title: string;
  status: string;
  visibility: string;
  userId: number;
  recipients: Array<{ id: number; email: string; role: string }>;
  fields: Array<{ id: number; type: string }>;
} | null>;
declare const getTeamBySlug_legacyEditor: (opts: { userId: number; teamSlug: string }) => Promise<{ id: number; url: string; currentTeamRole: string }>;
declare const isContractComplete_legacyEditor: (status: string) => boolean;
declare const canAccessTeamContract_legacyEditor: (role: string, visibility: string) => boolean;
declare const formatContractsPath_legacyEditor: (teamUrl: string) => string;
declare const logContractAccess_legacyEditor: (opts: { request: Request; contractId: number; userId: number }) => void;
declare const superLoaderJson_legacyEditor: <T>(data: T) => T;
declare const useSuperLoaderData_legacyEditor: <T>() => T;
declare const redirect_legacyEditor: (path: string) => never;

type LegacyEditorLoaderArgs = { params: { id?: string; teamUrl?: string }; request: Request };

export async function loader_legacyContractEditor({ params, request }: LegacyEditorLoaderArgs) {
  const { id, teamUrl } = params;

  if (!id || !teamUrl) {
    throw new Response('Not Found', { status: 404 });
  }

  const { user } = await getSessionUser_legacyEditor(request);
  const team = await getTeamBySlug_legacyEditor({ userId: user.id, teamSlug: teamUrl });
  const contractRootPath = formatContractsPath_legacyEditor(team.url);

  const contract = await getContractById_legacyEditor({
    id: { type: 'envelopeId', id },
    userId: user.id,
    teamId: team.id,
  }).catch(() => null);

  if (!contract) {
    throw new Response('Not Found', { status: 404 });
  }

  const isRecipient = contract.recipients.find((r) => r.email === user.email);
  let canAccess = true;
  if (!isRecipient && contract.userId !== user.id) {
    canAccess = canAccessTeamContract_legacyEditor(team.currentTeamRole, contract.visibility);
  }
  if (!canAccess) throw new Response('Not Found', { status: 404 });

  if (isContractComplete_legacyEditor(contract.status)) {
    redirect_legacyEditor(`${contractRootPath}/${id}`);
  }

  logContractAccess_legacyEditor({ request, contractId: contract.id, userId: user.id });

  return superLoaderJson_legacyEditor({ contract, contractRootPath, team });
}

export default function LegacyContractEditorRoute() {
  const { contract, contractRootPath, team } = useSuperLoaderData_legacyEditor<ReturnType<typeof loader_legacyContractEditor>>();

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <a href={contractRootPath} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <span aria-hidden>←</span>
          <span>Back to contracts</span>
        </a>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">{contract.title}</span>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{contract.title}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{contract.status}</span>
            {contract.recipients.length > 0 && (
              <>
                <span>·</span>
                <span>{contract.recipients.length} recipient(s)</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Legacy editor — edit contract fields and settings here.
          </div>
        </div>
      </div>
    </div>
  );
}
