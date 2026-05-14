declare const searchParams: URLSearchParams;

function getTemplateListParams() {
  const page = Number(searchParams.get('page')) || 1;
  const perPage = Number(searchParams.get('perPage')) || 10;
  return { page, perPage };
}



declare function useLoaderDataTyped<T>(): T;
declare function useCurrentTeam2(): { url: string; name: string };

export default function TemplatesIndexPage() {
  const team = useCurrentTeam2();
  const { templates } = useLoaderDataTyped<{ templates: Array<{ id: string; name: string; createdAt: string }> }>();

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-8">
      <h1 className="text-2xl font-bold">Templates</h1>
      <p className="mt-1 text-muted-foreground">Manage templates for {team.name}</p>
      <ul className="mt-6 space-y-2">
        {templates.map((tpl) => (
          <li key={tpl.id} className="rounded border p-3">
            <span className="font-medium">{tpl.name}</span>
            <span className="ml-2 text-sm text-gray-500">{tpl.createdAt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}



declare const useCurrentTeam2: () => { id: number; url: string; name: string };
declare const useCurrentOrganisation2: () => { id: number; type: string };
declare const useParams2: () => { folderId?: string };
declare const useSearchParams2: () => [URLSearchParams, unknown];
declare const useQueryState2: <T>(key: string, parser: unknown) => [T, (v: T) => void];
declare const parseAsStringLiteral2: (values: readonly string[]) => unknown;
declare const useSessionStorage2: <T>(key: string, initial: T) => [T, (v: T) => void];
declare const useMemo2: <T>(fn: () => T, deps: unknown[]) => T;
declare const useState2: <T>(v: T) => [T, (v: T) => void];
declare const TemplatesDataTable: React.FC<{ teamId: number; folderId?: string; page: number; perPage: number; view: string; isOrgView: boolean }>;
declare const FolderNavigation: React.FC<{ folderId?: string; teamId: number }>;
declare const BulkActionsBar: React.FC<{ selectedCount: number; onClear: () => void }>;
declare const React: { FC: unknown; ReactNode: unknown };
declare type RowSelectionState = Record<string, boolean>;
declare const OrganisationType: { PERSONAL: string };

const TEMPLATE_VIEW_OPTIONS = ['team', 'org'] as const;
type TemplateViewOption = (typeof TEMPLATE_VIEW_OPTIONS)[number];

export default function TeamTemplatesPage() {
  const team = useCurrentTeam2();
  const organisation = useCurrentOrganisation2();

  const { folderId } = useParams2();
  const [searchParams] = useSearchParams2();

  const page = Number(searchParams.get('page')) || 1;
  const perPage = Number(searchParams.get('perPage')) || 10;

  const [view, setView] = useQueryState2<TemplateViewOption>('view', parseAsStringLiteral2(TEMPLATE_VIEW_OPTIONS));

  const isOrgView = view === 'org';
  const showOrgTab = organisation.type !== OrganisationType.PERSONAL;

  const [rowSelection, setRowSelection] = useSessionStorage2<RowSelectionState>('team-templates-selection', {});
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState2(false);

  const selectedIds = useMemo2(() => Object.keys(rowSelection).filter((id) => rowSelection[id]), [rowSelection]);

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>

        {showOrgTab && (
          <div className="flex gap-2">
            <button
              className={isOrgView ? 'font-semibold underline' : ''}
              onClick={() => setView('org')}
            >
              Organisation
            </button>
            <button
              className={!isOrgView ? 'font-semibold underline' : ''}
              onClick={() => setView('team')}
            >
              Team
            </button>
          </div>
        )}
      </div>

      {selectedIds.length > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.length}
          onClear={() => setRowSelection({})}
        />
      )}

      <FolderNavigation folderId={folderId} teamId={team.id} />

      <TemplatesDataTable
        teamId={team.id}
        folderId={folderId}
        page={page}
        perPage={perPage}
        view={view ?? 'team'}
        isOrgView={isOrgView}
      />
    </div>
  );
}
