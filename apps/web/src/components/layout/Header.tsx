'use client';

import { Sun, Moon, ArrowLeft, GitBranch, Loader2, PanelRightClose, PanelRightOpen } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

type HeaderProps = {
  repoName?: string;
  branches?: string[];
  selectedBranch?: string;
  onBranchChange?: (branch: string) => void;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  showBack?: boolean;
  backHref?: string;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
};

export function Header({
  repoName,
  branches,
  selectedBranch,
  onBranchChange,
  onAnalyze,
  isAnalyzing,
  showBack,
  backHref = '/',
  isSidebarOpen,
  onToggleSidebar,
}: HeaderProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        {showBack && (
          <Link
            href={backHref}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <Link href="/" className="text-lg font-bold text-foreground">
          TrueCourse
        </Link>
      </div>

      <div className="flex items-center gap-3">
        {repoName && (
          <span className="text-sm font-medium text-foreground">
            {repoName}
          </span>
        )}
        {branches && branches.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={selectedBranch || ''}
              onChange={(e) => onBranchChange?.(e.target.value)}
              className="bg-transparent text-sm text-foreground outline-none"
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )}
        {onAnalyze && (
          <Button size="sm" onClick={onAnalyze} disabled={isAnalyzing}>
            {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close panel' : 'Open panel'}
          >
            {isSidebarOpen ? (
              <PanelRightClose className="h-5 w-5" />
            ) : (
              <PanelRightOpen className="h-5 w-5" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
      </div>
    </header>
  );
}
