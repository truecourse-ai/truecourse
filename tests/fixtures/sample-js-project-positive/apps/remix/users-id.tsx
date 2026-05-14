
declare const useLoaderData: <T>() => T;
declare const useNavigate: () => (path: string) => void;
declare function useState<T>(init: T): [T, (v: T) => void];
declare const useMutation: (opts: any) => { mutateAsync: (...a: any[]) => Promise<any>; isPending: boolean };
declare const useToast: () => { toast: (opts: any) => void };
declare const Avatar: any;
declare const AvatarFallback: any;
declare const AvatarImage: any;
declare const Badge: any;
declare const Button: any;
declare const DataTable: any;
declare const Separator: any;
declare const format: (date: Date, fmt: string) => string;
declare const ConfirmDialog: any;

type AdminUserDetailData = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  documentCount: number;
  recentDocuments: Array<{ id: string; title: string; status: string; createdAt: string }>;
};

export default function AdminUserDetailPage() {
  const user = useLoaderData<AdminUserDetailData>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  const { mutateAsync: toggleActive, isPending } = useMutation({
    onSuccess: () => {
      toast({ title: user.isActive ? 'User deactivated' : 'User activated' });
      navigate(`.`, { replace: true });
    },
    onError: () => {
      toast({ title: 'Action failed', variant: 'destructive' });
    },
  });

  const handleToggleActive = async () => {
    await toggleActive({ userId: user.id, active: !user.isActive });
    setShowDeactivateConfirm(false);
  };

  const documentColumns = [
    {
      key: 'title',
      header: 'Document',
      render: (row: any) => <span className="text-sm font-medium">{row.title}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: any) => <Badge variant="outline">{row.status}</Badge>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (row: any) => (
        <span className="text-sm">{format(new Date(row.createdAt), 'MMM d, yyyy')}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user.avatarUrl ?? undefined} />
          <AvatarFallback>
            {(user.name ?? user.email).slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <h1 className="text-xl font-bold">{user.name ?? 'No name'}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>

          <div className="mt-2 flex items-center gap-2">
            <Badge>{user.role}</Badge>
            <Badge variant={user.isActive ? 'default' : 'destructive'}>
              {user.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </div>

        <Button
          variant={user.isActive ? 'destructive' : 'default'}
          onClick={() => user.isActive ? setShowDeactivateConfirm(true) : handleToggleActive()}
          disabled={isPending}
        >
          {user.isActive ? 'Deactivate' : 'Activate'}
        </Button>
      </div>

      <Separator />

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Documents</p>
          <p className="mt-1 text-2xl font-bold">{user.documentCount}</p>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Member since</p>
          <p className="mt-1 text-sm font-medium">
            {format(new Date(user.createdAt), 'MMM d, yyyy')}
          </p>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Last sign-in</p>
          <p className="mt-1 text-sm font-medium">
            {user.lastSignInAt
              ? format(new Date(user.lastSignInAt), 'MMM d, yyyy HH:mm')
              : 'Never'}
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-base font-semibold">Recent documents</h2>
        <DataTable
          columns={documentColumns}
          data={user.recentDocuments}
          totalCount={user.recentDocuments.length}
          isLoading={false}
        />
      </div>

      <ConfirmDialog
        open={showDeactivateConfirm}
        onOpenChange={setShowDeactivateConfirm}
        title="Deactivate user?"
        description="The user will lose access to their account immediately."
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={handleToggleActive}
        isLoading={isPending}
      />
    </div>
  );
}
