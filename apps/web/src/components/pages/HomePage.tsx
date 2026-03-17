import { Header } from '@/components/layout/Header';
import { RepoSelector } from '@/components/repo/RepoSelector';
import { RepoList } from '@/components/repo/RepoList';
import { useRepo } from '@/hooks/useRepo';
import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function HomePage() {
  const { repos, isLoading, error, addRepo, deleteRepo } =
    useRepo();

  const handleDelete = async (id: string) => {
    try {
      await deleteRepo(id);
    } catch {
      // Error is handled in hook
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-foreground">
            TrueCourse
          </h1>
          <p className="mt-2 text-muted-foreground">
            Visualize and understand your codebase architecture
          </p>
        </div>

        <div className="mb-8 space-y-5">
          {/* Primary: CLI command */}
          <div className="flex flex-col items-center gap-2.5 rounded-lg border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Run this from your project directory:
            </p>
            <code className="rounded-md bg-muted px-4 py-2.5 font-mono text-sm text-foreground select-all">
              npx truecourse add
            </code>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or add manually</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Secondary: path input */}
          <RepoSelector onAdd={addRepo} />
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <RepoList
            repos={repos}
            onDelete={handleDelete}
          />
        )}
      </main>
    </div>
  );
}
