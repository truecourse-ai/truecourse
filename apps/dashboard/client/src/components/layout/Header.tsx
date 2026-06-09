
import { Sun, Moon, ArrowLeft, Loader2, Github, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import type { AnalysisSummary } from '@/lib/api';
import { SectionSwitcher } from './SectionSwitcher';
import { BranchLabel } from './BranchLabel';
import { DiffModeToggle } from './DiffModeToggle';
import { RunHistoryDropdown } from './RunHistoryDropdown';
import type { DashboardSection } from './LeftSidebar';
import { EeNavSlot } from '@/ee/EeNavSlot';
import { EeUserMenu } from '@/ee/EeUserMenu';
import { DiscordIcon, GITHUB_URL, DISCORD_URL } from './social';
import { useEdition } from '@/contexts/CapabilityContext';
import { useThemeToggle } from '@/hooks/useThemeToggle';

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
  /** When provided, render the section switcher next to the logo. */
  dashboardSection?: DashboardSection;
  onDashboardSectionChange?: (next: DashboardSection) => void;
  /** Section-specific action buttons (e.g. Apply for Spec, Run for
   * Verify). Rendered just before the Analyze button so global actions
   * for the current section sit alongside Analyze instead of in a
   * separate row that disappears when switching tabs (which caused the
   * left sidebar to visibly shift). */
  sectionActions?: React.ReactNode;
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
  dashboardSection,
  onDashboardSectionChange,
  sectionActions,
}: HeaderProps) {
  const edition = useEdition();
  const { isDark, toggle: toggleTheme } = useThemeToggle();

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
        {dashboardSection && onDashboardSectionChange && (
          <>
            <span className="text-muted-foreground/60">/</span>
            <SectionSwitcher value={dashboardSection} onChange={onDashboardSectionChange} />
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        {repoName && (
          <span className="text-sm font-medium text-foreground">
            {repoName}
          </span>
        )}
        <BranchLabel branch={currentBranch} />
        {analyses && onSelectAnalysis && (
          <RunHistoryDropdown
            items={analyses.map((a) => {
              const date = new Date(a.createdAt);
              return {
                id: a.id,
                label: `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                branch: a.branch,
              };
            })}
            selectedId={selectedAnalysisId ?? null}
            onSelect={onSelectAnalysis}
          />
        )}
        {onEnterDiffMode && (
          <DiffModeToggle
            diffMode={!!isDiffMode}
            onToggle={(d) => (d ? onEnterDiffMode?.() : onExitDiffMode?.())}
            subject={{ verb: 'analyzes', plural: 'violations' }}
          />
        )}
        {sectionActions && (
          <div className="flex items-center gap-2">{sectionActions}</div>
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
        {/* In enterprise the console shell (left sidebar) owns global nav, the
            user menu, and GitHub/Discord/theme — so the repo header keeps its
            right side clear instead of duplicating them. Community shows them
            here (EeNavSlot / EeUserMenu render nothing without the ee module). */}
        {edition !== 'enterprise' && (
          <>
            <EeNavSlot />
            <EeUserMenu />
            <a
              href={GITHUB_URL}
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
              href={DISCORD_URL}
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
          </>
        )}
      </div>
    </header>
  );
}

