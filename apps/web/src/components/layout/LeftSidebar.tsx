'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Shield, FolderTree } from 'lucide-react';

export type LeftTab = 'violations' | 'rules' | 'files';

type LeftSidebarProps = {
  activeTab: LeftTab | null;
  onTabChange: (tab: LeftTab | null) => void;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
};

const tabs: { id: LeftTab; icon: typeof AlertTriangle; label: string }[] = [
  { id: 'violations', icon: AlertTriangle, label: 'Violations' },
  { id: 'rules', icon: Shield, label: 'Rules' },
  { id: 'files', icon: FolderTree, label: 'Files' },
];

export function LeftSidebar({
  activeTab,
  onTabChange,
  children,
  defaultWidth = 350,
  minWidth = 260,
}: LeftSidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [maxWidth, setMaxWidth] = useState(800);
  const isDragging = useRef(false);

  useEffect(() => {
    const calc = () => Math.floor(window.innerWidth * 0.8);
    setMaxWidth(calc());
    const onResize = () => setMaxWidth(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = moveEvent.clientX - startX;
        setWidth(Math.min(maxWidth, Math.max(minWidth, startWidth + delta)));
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth, maxWidth],
  );

  const isOpen = activeTab !== null;

  return (
    <div className="flex flex-shrink-0 h-full">
      {/* Icon rail */}
      <div className="flex w-12 flex-col items-center gap-1 border-r border-border bg-card pt-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(isActive ? null : tab.id)}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              aria-label={tab.label}
            >
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
              )}
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>

      {/* Content panel */}
      {isOpen && (
        <aside
          className="relative flex-shrink-0 border-r border-border bg-card"
          style={{ width }}
        >
          {/* Panel header */}
          <div className="flex h-10 items-center border-b border-border px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {activeTab === 'violations' ? 'Violations' : activeTab === 'rules' ? 'Rules' : 'Files'}
            </span>
          </div>

          {/* Panel content */}
          <div className="h-[calc(100%-40px)] overflow-hidden">
            {children}
          </div>

          {/* Resize handle on right edge */}
          <div
            className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
            onMouseDown={handleMouseDown}
          />
        </aside>
      )}
    </div>
  );
}
