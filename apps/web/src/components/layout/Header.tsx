'use client';

import { Sun, Moon, ArrowLeft, GitBranch, Loader2, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

type HeaderProps = {
  repoName?: string;
  currentBranch?: string;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  showBack?: boolean;
  backHref?: string;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
};

export function Header({
  repoName,
  currentBranch,
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
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-foreground">
          <img src="/logo.svg" alt="TrueCourse" className="h-7 w-7" />
          TrueCourse
        </Link>
      </div>

      <div className="flex items-center gap-3">
        {repoName && (
          <span className="text-sm font-medium text-foreground">
            {repoName}
          </span>
        )}
        {currentBranch && (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm text-foreground">{currentBranch}</span>
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
            variant={isSidebarOpen ? 'default' : 'outline'}
            size="sm"
            onClick={onToggleSidebar}
            aria-label="Toggle Agent"
          >
            <MessageCircle className="h-4 w-4" />
            Agent
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
