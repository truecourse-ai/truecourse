
// --- FP shape: Remix async loader export; return type inferred. Framework-conventional export ---
declare function getSession(req: unknown): Promise<{ user: { id: string } }>;
declare function getTeamByUrl(args: { userId: string; teamUrl: string }): Promise<{ id: string; currentTeamRole: string } | null>;
declare function redirect(url: string): never;
declare function canExecuteTeamAction(action: string, role: string): boolean;
declare function data(payload: unknown): unknown;

export async function loader({ request, params }: { request: unknown; params: { teamUrl: string } }) {
  const session = await getSession(request);

  const team = await getTeamByUrl({
    userId: session.user.id,
    teamUrl: params.teamUrl,
  });

  if (!team || !canExecuteTeamAction('MANAGE_TEAM', team.currentTeamRole)) {
    throw redirect(`/t/${params.teamUrl}`);
  }

  return data({ teamId: team.id });
}



// --- FP shape: Remix default page component returning JSX; trivially inferred. Framework convention ---
declare function useSession2(): { user: { id: string } };
declare function useCurrentTeam2(): { id: string; url: string };

export default function TemplatePage({ params }: { params: { id: string; teamUrl: string } }) {
  const { user } = useSession2();
  const team = useCurrentTeam2();

  return (
    <div>
      <h1>Template #{params.id}</h1>
      <p>Team: {team.url}</p>
    </div>
  );
}



// --- FP shape: Remix meta export returning an array; return type trivially inferred. Framework convention ---
declare function appMetaTags(label: string): Array<{ title?: string; name?: string; content?: string }>;
declare function msg(strings: TemplateStringsArray): string;

export function metaPublicProfile() {
  return appMetaTags(msg`Public Profile`);
}



// --- FP shape: Remix meta export; return type trivially inferred. Framework convention ---
declare function appMetaTags2(label: string): Array<{ title?: string; name?: string; content?: string }>;
declare function msg2(strings: TemplateStringsArray): string;

export function metaTemplates() {
  return appMetaTags2(msg2`Templates`);
}



declare namespace Route { interface LoaderArgs { request: Request; params: { teamUrl: string } } }
declare function getSession(request: Request): Promise<{ user: { id: string } }>;
declare function getTeamByUrl(opts: { userId: string; teamUrl: string }): Promise<{ currentTeamRole: string } | null>;
declare function redirect(url: string): never;

export async function clientLoader() {
  // SSR only — no client-side data fetching needed
}
