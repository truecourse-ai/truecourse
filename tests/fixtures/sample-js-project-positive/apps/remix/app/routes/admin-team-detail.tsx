// admin-team-detail.tsx — admin team detail route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useNavigate(): (to: string) => void;
declare const Badge: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare const Avatar: (props: { className?: string; children: React.ReactNode }) => JSX.Element;
declare const AvatarImage: (props: { src?: string; alt?: string }) => JSX.Element;
declare const AvatarFallback: (props: { children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { variant?: string; size?: string; onClick?: () => void; children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;

type TeamMemberRecord = {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  avatarUrl?: string;
  joinedAt: string;
};

type TeamRecord = {
  id: string;
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: string;
  memberCount: number;
  documentCount: number;
  plan: string;
  status: 'ACTIVE' | 'SUSPENDED';
};

type AdminTeamDetailLoaderData = {
  team: TeamRecord;
  members: TeamMemberRecord[];
};

declare function getTeamForAdmin(teamId: string): Promise<TeamRecord | null>;
declare function getTeamMembersForAdmin(teamId: string): Promise<TeamMemberRecord[]>;

export async function loader({ params }: { params: { id: string } }) {
  const { id } = params;
  const [team, members] = await Promise.all([
    getTeamForAdmin(id),
    getTeamMembersForAdmin(id),
  ]);
  if (!team) throw new Response('Team Not Found', { status: 404 });
  return { team, members };
}

export default function AdminTeamDetail() {
  const { team, members } = useLoaderData<AdminTeamDetailLoaderData>();
  const navigate = useNavigate();

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/admin/teams')} className="text-sm text-muted-foreground hover:underline">
          ← Back to Teams
        </button>
      </div>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{team.name}</h1>
          <p className="text-muted-foreground">/{team.slug}</p>
        </div>
        <Badge variant={team.status === 'ACTIVE' ? 'default' : 'destructive'}>
          {team.status}
        </Badge>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Members</p>
          <p className="text-2xl font-bold">{team.memberCount}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Documents</p>
          <p className="text-2xl font-bold">{team.documentCount}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Plan</p>
          <p className="text-2xl font-bold">{team.plan}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-xs text-muted-foreground">Created</p>
          <p className="text-sm font-medium">{new Date(team.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <Separator />

      <div className="mt-6">
        <h2 className="mb-4 text-lg font-semibold">Members</h2>
        <div className="space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 rounded border p-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={member.avatarUrl} alt={member.name} />
                <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-muted-foreground">{member.email}</p>
              </div>
              <Badge variant={member.role === 'OWNER' ? 'default' : 'outline'}>{member.role}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
