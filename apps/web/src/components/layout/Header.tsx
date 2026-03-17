
import { Sun, Moon, ArrowLeft, Loader2, MessageCircle, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';

type HeaderProps = {
  repoName?: string;
  currentBranch?: string;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  showBack?: boolean;
  backHref?: string;
  isChatOpen?: boolean;
  onToggleChat?: () => void;
  isDiffMode?: boolean;
  onEnterDiffMode?: () => void;
  onExitDiffMode?: () => void;
};

export function Header({
  repoName,
  currentBranch,
  onAnalyze,
  isAnalyzing,
  showBack,
  backHref = '/',
  isChatOpen,
  onToggleChat,
  isDiffMode,
  onEnterDiffMode,
  onExitDiffMode,
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
            to={backHref}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
        )}
        <Link to="/" className="flex items-center gap-2 text-lg font-bold text-foreground">
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
          <span className="text-xs text-muted-foreground font-mono">{currentBranch}</span>
        )}
        {onEnterDiffMode && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-md border border-border bg-card shadow-sm">
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-l-md transition-colors ${
                  !isDiffMode ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => { if (isDiffMode) onExitDiffMode?.(); }}
              >
                Normal
              </button>
              <button
                className={`px-3 py-1.5 text-xs font-medium rounded-r-md transition-colors ${
                  isDiffMode ? 'bg-amber-500/20 text-amber-500' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => { if (!isDiffMode) onEnterDiffMode?.(); }}
              >
                Git Diff
              </button>
            </div>
            <div className="group/info relative">
              <Info className="h-3.5 w-3.5 text-muted-foreground/50 hover:text-muted-foreground cursor-help transition-colors" />
              <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 z-[9999] hidden group-hover/info:block">
                <div className="rounded-lg border border-border bg-popover px-4 py-3 shadow-lg w-[280px] text-[11px] leading-relaxed text-popover-foreground">
                  <p className="font-semibold mb-1.5">Normal mode</p>
                  <p className="text-muted-foreground">Stashes pending changes, analyzes the committed code, then restores your changes. The baseline is always the committed state.</p>
                  <div className="my-2 border-t border-border" />
                  <p className="font-semibold mb-1.5">Git Diff mode</p>
                  <p className="text-muted-foreground">Compares your working tree against the last analysis baseline. Shows which violations your pending changes introduce or resolve.</p>
                </div>
              </div>
            </div>
          </div>
        )}
        {onAnalyze && (
          <Button
            size="sm"
            onClick={onAnalyze}
            disabled={isAnalyzing}
          >
            {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onToggleChat && (
          <Button
            variant={isChatOpen ? 'default' : 'outline'}
            size="sm"
            onClick={onToggleChat}
            aria-label="Toggle Chat"
          >
            <MessageCircle className="h-4 w-4" />
            Chat
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
