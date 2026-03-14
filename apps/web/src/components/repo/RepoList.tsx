'use client';

import Link from 'next/link';
import { Folder, Clock, BarChart3, Eye, Trash2 } from 'lucide-react';
import type { RepoResponse } from '@/lib/api';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';

type RepoListProps = {
  repos: RepoResponse[];
  onAnalyze: (id: string) => void;
  onDelete: (id: string) => void;
};

export function RepoList({ repos, onAnalyze, onDelete }: RepoListProps) {
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
        <Card
          key={repo.id}
          className="flex flex-col transition-shadow hover:shadow-md"
        >
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">
                {repo.name}
              </CardTitle>
              <CardDescription className="mt-0.5 truncate text-xs">
                {repo.path}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(repo.id)}
              className="ml-2 flex-shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Delete repository"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardHeader>

          <CardContent className="pb-2">
            {repo.lastAnalyzed && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
            )}
          </CardContent>

          <CardFooter className="mt-auto gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onAnalyze(repo.id)}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Analyze
            </Button>
            <Link
              href={`/repos/${repo.id}`}
              className={buttonVariants({ size: 'sm', className: 'flex-1' })}
            >
              <Eye className="h-3.5 w-3.5" />
              View Graph
            </Link>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
