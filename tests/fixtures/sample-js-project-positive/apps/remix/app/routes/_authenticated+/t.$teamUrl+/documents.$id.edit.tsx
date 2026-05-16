
declare namespace Route { interface ComponentProps { params: { id: string; teamUrl: string } } }
declare function useNavigate(): (path: string) => void;
declare function useCurrentTeam(): { url: string; name: string };

export default function DocumentEditorPage({ params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const team = useCurrentTeam();

  const handleClose = () => {
    navigate(`/t/${team.url}/documents`);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <button onClick={handleClose}>Close</button>
      </header>
      <main className="flex-1 overflow-auto">
        <p>Editing document {params.id}</p>
      </main>
    </div>
  );
}
