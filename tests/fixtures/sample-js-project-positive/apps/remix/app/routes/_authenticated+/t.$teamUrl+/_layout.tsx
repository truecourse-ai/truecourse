declare const useSession: () => { user: { id: string; name: string }; teams: Array<{ id: string; url: string; name: string }> };
declare const useParams: () => Record<string, string | undefined>;
declare const Outlet: () => JSX.Element;
declare const Sidebar: (props: { teamUrl: string; children?: React.ReactNode }) => JSX.Element;
declare const TeamHeader: (props: { teamName: string }) => JSX.Element;
declare const redirect: (url: string) => never;

export async function teamLoader({ params }: { params: { teamUrl?: string } }) {
  if (!params.teamUrl) {
    throw redirect('/dashboard');
  }
  return { teamUrl: params.teamUrl };
}

export default function TeamLayout() {
  const { user, teams } = useSession();
  const { teamUrl } = useParams();

  const currentTeam = teams.find((t) => t.url === teamUrl);

  if (!currentTeam) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Team not found</h1>
          <p className="mt-2 text-muted-foreground">
            You don't have access to this team or it doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-row">
      <Sidebar teamUrl={currentTeam.url}>
        <div className="flex flex-col gap-1 px-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-2 py-1">
            Team
          </span>
        </div>
      </Sidebar>
      <div className="flex flex-1 flex-col">
        <TeamHeader teamName={currentTeam.name} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
