// --- unused-export shape: framework-convention-default-export (Remix route default export, list page) ---
// The Remix router loads the default export by convention; no explicit import needed.

declare function useLoaderData<T>(): T;
declare namespace React { type ReactNode = unknown; }

type DocumentItem = { id: string; title: string; status: string; createdAt: string };

function DocumentsPage(): JSX.Element {
  const documents = useLoaderData<DocumentItem[]>();
  return (
    <ul className="divide-y">
      {documents.map((doc) => (
        <li key={doc.id} className="py-3">
          <span className="font-medium">{doc.title}</span>
          <span className="ml-2 text-sm text-gray-500">{doc.status}</span>
        </li>
      ))}
    </ul>
  );
}

export default DocumentsPage;



// --- argument-type-mismatch FP: .map() rendering Link components in JSX list ---
declare function Link(props: { to: string; className?: string; children?: React.ReactNode }): JSX.Element;

interface WorkspaceTeam { id: number; name: string; slug: string; avatarUrl?: string; }

function TeamGrid({ teams }: { teams: WorkspaceTeam[] }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {teams.map((team) => (
        <Link key={team.id} to={`/teams/${team.slug}`} className="rounded border p-4">
          {team.avatarUrl && <img src={team.avatarUrl} alt="" />}
          <span>{team.name}</span>
        </Link>
      ))}
    </div>
  );
}



// Shape: array.filter() comparing string status field to string literal — valid equality filter, no type mismatch
declare const contract: {
  signatories: Array<{ id: number; email: string; signingStatus: string }>;
};

export function getPendingSignatories() {
  return contract.signatories.filter((signatory) => signatory.signingStatus !== 'SIGNED');
}
