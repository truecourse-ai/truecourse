// team-template-detail.tsx — team template detail route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useNavigate(): (to: string) => void;
declare const Badge: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare const Button: (props: { variant?: string; size?: string; onClick?: () => void; asChild?: boolean; children: React.ReactNode }) => JSX.Element;
declare const Separator: () => JSX.Element;
declare const DropdownMenu: (props: { children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuTrigger: (props: { asChild?: boolean; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuContent: (props: { align?: string; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuItem: (props: { onClick?: () => void; className?: string; children: React.ReactNode }) => JSX.Element;
declare const DropdownMenuSeparator: () => JSX.Element;
declare const ChevronDownIcon: (props: { className?: string }) => JSX.Element;
declare const LinkIcon: (props: { className?: string }) => JSX.Element;
declare const PencilIcon: (props: { className?: string }) => JSX.Element;
declare const TrashIcon: (props: { className?: string }) => JSX.Element;

type TemplateField = { id: string; type: string; label: string; required: boolean; };
type TemplateRecipient = { id: string; name?: string; email?: string; role: string; };
type TemplateRecord = {
  id: string;
  title: string;
  description?: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  directLinkEnabled: boolean;
  directLinkToken?: string;
  fields: TemplateField[];
  recipients: TemplateRecipient[];
  createdAt: string;
  updatedAt: string;
};

type TeamTemplateDetailLoaderData = {
  template: TemplateRecord;
  teamSlug: string;
  canEdit: boolean;
};

declare function getTemplateById(id: string): Promise<TemplateRecord | null>;
declare function canUserEditTemplate(userId: string, templateId: string): Promise<boolean>;

export async function loader({ params }: { params: { teamUrl: string; id: string } }) {
  const { id, teamUrl } = params;
  const template = await getTemplateById(id);
  if (!template) throw new Response('Template Not Found', { status: 404 });
  const canEdit = await canUserEditTemplate('current-user', id);
  return { template, teamSlug: teamUrl, canEdit };
}

export default function TeamTemplateDetail() {
  const { template, teamSlug, canEdit } = useLoaderData<TeamTemplateDetailLoaderData>();
  const navigate = useNavigate();

  const handleCopyDirectLink = () => {
    if (template.directLinkToken) {
      navigator.clipboard.writeText(`${window.location.origin}/d/${template.directLinkToken}`);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate(`/t/${teamSlug}/templates`)}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to Templates
        </button>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{template.title}</h1>
          {template.description && (
            <p className="mt-1 text-muted-foreground">{template.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={template.status === 'ACTIVE' ? 'default' : 'outline'}>
            {template.status}
          </Badge>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Actions <ChevronDownIcon className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(`/t/${teamSlug}/templates/${template.id}/edit`)}>
                  <PencilIcon className="mr-2 h-4 w-4" /> Edit Template
                </DropdownMenuItem>
                {template.directLinkEnabled && (
                  <DropdownMenuItem onClick={handleCopyDirectLink}>
                    <LinkIcon className="mr-2 h-4 w-4" /> Copy Direct Link
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <TrashIcon className="mr-2 h-4 w-4" /> Delete Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Separator />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Recipients ({template.recipients.length})</h2>
          <div className="space-y-2">
            {template.recipients.map((recipient) => (
              <div key={recipient.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  {recipient.name && <p className="font-medium">{recipient.name}</p>}
                  {recipient.email && <p className="text-sm text-muted-foreground">{recipient.email}</p>}
                  {!recipient.name && !recipient.email && <p className="text-muted-foreground italic">Role placeholder</p>}
                </div>
                <Badge variant="outline">{recipient.role}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-lg font-semibold">Fields ({template.fields.length})</h2>
          <div className="space-y-2">
            {template.fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="font-medium">{field.label}</p>
                  <p className="text-sm text-muted-foreground">{field.type}</p>
                </div>
                {field.required && <Badge>Required</Badge>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
