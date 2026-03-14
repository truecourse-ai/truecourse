'use client';

import Link from 'next/link';
import { Folder, Clock, Trash2, ArrowRight } from 'lucide-react';
import type { RepoResponse } from '@/lib/api';

type RepoListProps = {
  repos: RepoResponse[];
  onDelete: (id: string) => void;
};

export function RepoList({ repos, onDelete }: RepoListProps) {
  const handleDelete = (e: React.MouseEvent, repo: RepoResponse) => {
    e.preventDefault();
    e.stopPropagation();
    const message = repo.lastAnalyzed
      ? `Delete "${repo.name}"? This will remove all analyses, insights, and chat history.`
      : `Delete "${repo.name}"?`;
    if (confirm(message)) {
      onDelete(repo.id);
    }
  };

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Folder className="mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">
          No repositories yet
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a repository path above to get started
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((repo) => (
        <Link
          key={repo.id}
          href={`/repos/${repo.id}`}
          className="group relative flex flex-col rounded-xl border border-border bg-card p-4 ring-1 ring-foreground/10 transition-all hover:shadow-md hover:ring-primary/30"
        >
          {/* Delete button */}
          <button
            onClick={(e) => handleDelete(e, repo)}
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label="Delete repository"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          {/* Icon + Name */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Folder className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {repo.name}
              </h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {repo.path}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            {repo.lastAnalyzed ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>
                  Analyzed{' '}
                  {new Date(repo.lastAnalyzed).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">Not analyzed yet</span>
            )}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </div>
        </Link>
      ))}
    </div>
  );
}
