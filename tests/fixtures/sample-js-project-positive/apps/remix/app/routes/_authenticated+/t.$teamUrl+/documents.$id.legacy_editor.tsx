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
items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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

function _longFn_8230eb96(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
