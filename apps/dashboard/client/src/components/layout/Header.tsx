
import { Sun, Moon, ArrowLeft, Loader2, Info, ChevronDown, Github, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { AnalysisSummary } from '@/lib/api';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.683 12.683 0 0 0-.617-1.249.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.369a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.106c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419z" />
    </svg>
  );
}

type HeaderProps = {
  repoName?: string;
  currentBranch?: string;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  showBack?: boolean;
  backHref?: string;
  isDiffMode?: boolean;
  onEnterDiffMode?: () => void;
  onExitDiffMode?: () => void;
  analyses?: AnalysisSummary[];
  selectedAnalysisId?: string | null;
  onSelectAnalysis?: (analysisId: string | null) => void;
  currentAnalysisId?: string | null;
};

export function Header({
  repoName,
  currentBranch,
  onAnalyze,
  isAnalyzing,
  showBack,
  backHref = '/',
  isDiffMode,
  onEnterDiffMode,
  onExitDiffMode,
  analyses,
  selectedAnalysisId,
  onSelectAnalysis,
  currentAnalysisId,
}: HeaderProps) {
  const [isDark, setIsDark] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    if (historyOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [historyOpen]);

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
        {analyses && analyses.length > 1 && onSelectAnalysis && (
          <div className="relative" ref={historyRef}>
            <button
              className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setHistoryOpen((v) => !v)}
            >
              {selectedAnalysisId ? 'Past analysis' : 'Latest'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {historyOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-56 rounded-md border border-border bg-popover shadow-lg">
                <div className="max-h-64 overflow-y-auto py-1">
                  <button
                    className={`w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                      !selectedAnalysisId ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
                    }`}
                    onClick={() => { onSelectAnalysis(null); setHistoryOpen(false); }}
                  >
                    Latest
                  </button>
                  {analyses.map((a, i) => {
                    const date = new Date(a.createdAt);
                    const label = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    const isLatest = i === 0;
                    return (
                      <button
                        key={a.id}
                        className={`w-full whitespace-nowrap px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${
                          (isLatest ? !selectedAnalysisId : selectedAnalysisId === a.id) ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
                        }`}
                        onClick={() => { onSelectAnalysis(isLatest ? null : a.id); setHistoryOpen(false); }}
                      >
                        <span>{label}</span>
                        {a.branch && <span className="ml-1.5 font-mono opacity-60">{a.branch}</span>}
                        {i === 0 && <span className="ml-1.5 text-primary/70">(latest)</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
          <div className="relative flex items-center">
            <Button
              size="sm"
              onClick={() => onAnalyze()}
              disabled={isAnalyzing}
            >
              {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isAnalyzing ? 'Analyzing...' : 'Analyze'}
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <a
          href="https://github.com/truecourse-ai/truecourse"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' gap-1.5'}
          aria-label="Star TrueCourse on GitHub"
        >
          <Github className="h-4 w-4" />
          <Star className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Star</span>
        </a>
        <a
          href="https://discord.gg/8AYwf26A"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' gap-1.5 text-[#5865F2] hover:text-[#5865F2]'}
          aria-label="Join the TrueCourse Discord"
        >
          <DiscordIcon className="h-4 w-4" />
          <span className="text-xs font-medium">Discord</span>
        </a>
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

