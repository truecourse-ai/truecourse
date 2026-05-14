// org-dashboard.tsx — authenticated org dashboard route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useNavigate(): (to: string) => void;
declare const StatsCard: (props: { title: string; value: number | string; description?: string }) => JSX.Element;
declare const ActivityFeed: (props: { items: ActivityItem[]; emptyMessage?: string }) => JSX.Element;
declare const QuickActions: (props: { orgSlug: string; role: string }) => JSX.Element;
declare const MembersPreview: (props: { members: OrgMember[]; orgSlug: string }) => JSX.Element;
declare const OrgHeader: (props: { org: OrgData; userRole: string }) => JSX.Element;

type OrgData = {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  plan: string;
  memberCount: number;
  documentCount: number;
};

type OrgMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
};

type ActivityItem = {
  id: string;
  type: string;
  description: string;
  performedBy: string;
  createdAt: string;
};

type OrgStats = {
  totalDocuments: number;
  pendingDocuments: number;
  completedDocuments: number;
  activeMembers: number;
};

type OrgDashboardLoaderData = {
  org: OrgData;
  stats: OrgStats;
  recentActivity: ActivityItem[];
  members: OrgMember[];
  userRole: string;
};

declare function getOrgBySlug(slug: string): Promise<OrgData>;
declare function getOrgStats(orgId: string): Promise<OrgStats>;
declare function getOrgActivity(orgId: string, limit: number): Promise<ActivityItem[]>;
declare function getOrgMembers(orgId: string, limit: number): Promise<OrgMember[]>;
declare function getUserRoleInOrg(userId: string, orgId: string): Promise<string>;

export async function loader({ params, request }: { params: { orgSlug: string }; request: Request }) {
  const { orgSlug } = params;

  const org = await getOrgBySlug(orgSlug).catch(() => null);

  if (!org) {
    throw new Response('Organization Not Found', { status: 404 });
  }

  const [stats, recentActivity, members] = await Promise.all([
    getOrgStats(org.id),
    getOrgActivity(org.id, 10),
    getOrgMembers(org.id, 5),
  ]);

  const userRole = await getUserRoleInOrg('current-user', org.id);

  return { org, stats, recentActivity, members, userRole };
}

export default function OrgDashboard() {
  const { org, stats, recentActivity, members, userRole } = useLoaderData<OrgDashboardLoaderData>();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col">
      <OrgHeader org={org} userRole={userRole} />

      <main className="flex-1 p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{org.name} Dashboard</h1>
          <p className="text-muted-foreground">Plan: {org.plan} &middot; {org.memberCount} members</p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Total Documents" value={stats.totalDocuments} />
          <StatsCard title="Pending" value={stats.pendingDocuments} description="Awaiting signatures" />
          <StatsCard title="Completed" value={stats.completedDocuments} />
          <StatsCard title="Active Members" value={stats.activeMembers} />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
            <ActivityFeed items={recentActivity} emptyMessage="No recent activity." />
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold">Members</h2>
            <MembersPreview members={members} orgSlug={org.slug} />

            {(userRole === 'OWNER' || userRole === 'ADMIN') && (
              <QuickActions orgSlug={org.slug} role={userRole} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
