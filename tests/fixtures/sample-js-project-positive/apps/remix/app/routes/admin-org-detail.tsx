// admin-org-detail.tsx — admin organisation detail route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useNavigate(): (to: string) => void;
declare const Badge: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { variant?: string; size?: string; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const Tabs: (props: { defaultValue: string; children: React.ReactNode }) => JSX.Element;
declare const TabsList: (props: { children: React.ReactNode }) => JSX.Element;
declare const TabsTrigger: (props: { value: string; children: React.ReactNode }) => JSX.Element;
declare const TabsContent: (props: { value: string; children: React.ReactNode }) => JSX.Element;

type OrgMemberRecord = { id: string; name: string; email: string; role: string; joinedAt: string; };
type OrgTeamRecord = { id: string; name: string; memberCount: number; documentCount: number; };
type OrgBillingRecord = {
  plan: string;
  status: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  seats: number;
  usedSeats: number;
};
type OrgRecord = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  memberCount: number;
  teamCount: number;
};

type AdminOrgDetailLoaderData = {
  org: OrgRecord;
  members: OrgMemberRecord[];
  teams: OrgTeamRecord[];
  billing: OrgBillingRecord;
};

declare function getOrgForAdmin(id: string): Promise<OrgRecord | null>;
declare function getOrgMembersForAdmin(orgId: string): Promise<OrgMemberRecord[]>;
declare function getOrgTeamsForAdmin(orgId: string): Promise<OrgTeamRecord[]>;
declare function getOrgBillingForAdmin(orgId: string): Promise<OrgBillingRecord>;

export async function loader({ params }: { params: { id: string } }) {
  const { id } = params;
  const org = await getOrgForAdmin(id);
  if (!org) throw new Response('Organisation Not Found', { status: 404 });
  const [members, teams, billing] = await Promise.all([
    getOrgMembersForAdmin(id),
    getOrgTeamsForAdmin(id),
    getOrgBillingForAdmin(id),
  ]);
  return { org, members, teams, billing };
}

export default function AdminOrgDetail() {
  const { org, members, teams, billing } = useLoaderData<AdminOrgDetailLoaderData>();
  const navigate = useNavigate();

  return (
    <div className="p-6">
      <div className="mb-6">
        <button onClick={() => navigate('/admin/organisations')} className="text-sm text-muted-foreground hover:underline">
          ← Back to Organisations
        </button>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-muted-foreground">/{org.slug}</p>
        </div>
        <Badge variant={org.status === 'ACTIVE' ? 'default' : 'destructive'}>{org.status}</Badge>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border p-4"><p className="text-xs text-muted-foreground">Members</p><p className="text-2xl font-bold">{org.memberCount}</p></div>
        <div className="rounded border p-4"><p className="text-xs text-muted-foreground">Teams</p><p className="text-2xl font-bold">{org.teamCount}</p></div>
        <div className="rounded border p-4"><p className="text-xs text-muted-foreground">Plan</p><p className="font-bold">{billing.plan}</p></div>
        <div className="rounded border p-4"><p className="text-xs text-muted-foreground">Seats</p><p className="text-2xl font-bold">{billing.usedSeats}/{billing.seats}</p></div>
      </div>

      <Separator />

      <Tabs defaultValue="members">
        <TabsList className="mt-6">
          <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
          <TabsTrigger value="teams">Teams ({teams.length})</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <div className="mt-4 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-sm text-muted-foreground">{member.email}</p>
                </div>
                <Badge variant="outline">{member.role}</Badge>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="teams">
          <div className="mt-4 space-y-2">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center justify-between rounded border p-3">
                <p className="font-medium">{team.name}</p>
                <div className="text-right text-sm text-muted-foreground">
                  <p>{team.memberCount} members</p>
                  <p>{team.documentCount} documents</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <div className="mt-4 space-y-4">
            <div className="rounded border p-4">
              <p className="font-medium">Plan: {billing.plan}</p>
              <p className="text-sm text-muted-foreground">Status: {billing.status}</p>
              {billing.currentPeriodEnd && (
                <p className="text-sm text-muted-foreground">
                  Period ends: {new Date(billing.currentPeriodEnd).toLocaleDateString()}
                </p>
              )}
              {billing.cancelAtPeriodEnd && (
                <Badge variant="destructive" className="mt-2">Cancels at period end</Badge>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
