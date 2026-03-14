'use client';

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

        <div className="mb-8">
          <RepoSelector onAdd={addRepo} />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Or run <code className="rounded bg-muted px-1.5 py-0.5 font-mono">npx truecourse add</code> from your project directory to add it
          </p>
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
