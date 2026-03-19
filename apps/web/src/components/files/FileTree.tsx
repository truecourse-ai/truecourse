
import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, X, Loader2, Crosshair } from 'lucide-react';
import { buildFileTree, type FileTreeNode } from '@/lib/file-tree';
import * as api from '@/lib/api';
import { SEVERITY_COLORS } from '@/lib/severity-colors';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

type FileTreeProps = {
  repoId: string;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onOpenFile?: (path: string, pinned: boolean) => void;
  violationCounts?: Record<string, number>;
  violationSeverities?: Record<string, string>;
  revealPath?: string | null;
};

export function FileTree({ repoId, selectedPath, onSelectPath, onOpenFile, violationCounts, violationSeverities, revealPath }: FileTreeProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [repoRoot, setRepoRoot] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string> | null>(null);

  useEffect(() => {
    setIsLoading(true);
    api.getFiles(repoId)
      .then((data) => {
        setFiles(data.files);
        setRepoRoot(data.root.endsWith('/') ? data.root : data.root + '/');
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [repoId]);

  // Remap absolute-path keyed maps to relative paths matching the file tree
  const relViolationCounts = useMemo(() => {
    if (!violationCounts || !repoRoot) return violationCounts;
    const mapped: Record<string, number> = {};
    for (const [k, v] of Object.entries(violationCounts)) {
      mapped[k.startsWith(repoRoot) ? k.slice(repoRoot.length) : k] = v;
    }
    return mapped;
  }, [violationCounts, repoRoot]);

  const relViolationSeverities = useMemo(() => {
    if (!violationSeverities || !repoRoot) return violationSeverities;
    const mapped: Record<string, string> = {};
    for (const [k, v] of Object.entries(violationSeverities)) {
      mapped[k.startsWith(repoRoot) ? k.slice(repoRoot.length) : k] = v;
    }
    return mapped;
  }, [violationSeverities, repoRoot]);

  const tree = useMemo(() => buildFileTree(files), [files]);

  // Initialize expanded paths: expand top-level folders by default
  useEffect(() => {
    if (expandedPaths !== null || tree.children.length === 0) return;
    const initial = new Set<string>();
    for (const child of tree.children) {
      if (!child.isFile) initial.add(child.path);
    }
    setExpandedPaths(initial);
  }, [tree, expandedPaths]);

  // When revealPath changes, expand all ancestor folders and select the file
  useEffect(() => {
    if (!revealPath) {
      setActiveItem(null);
      return;
    }
    // Convert absolute path to relative if needed
    const relPath = repoRoot && revealPath.startsWith(repoRoot)
      ? revealPath.slice(repoRoot.length)
      : revealPath;
    setActiveItem(relPath);
    const parts = relPath.split('/');
    setExpandedPaths((prev) => {
      const next = new Set(prev || []);
      for (let i = 1; i < parts.length; i++) {
        next.add(parts.slice(0, i).join('/'));
      }
      return next;
    });
  }, [revealPath, repoRoot]);

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev || []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Compute folder-level violation counts and highest severity by propagating from files
  const { folderCounts, folderSeverities } = useMemo(() => {
    if (!relViolationCounts) return { folderCounts: undefined, folderSeverities: undefined };
    const counts: Record<string, number> = {};
    const severities: Record<string, string> = {};
    for (const [filePath, count] of Object.entries(relViolationCounts)) {
      const fileSeverity = relViolationSeverities?.[filePath];
      const parts = filePath.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join('/');
        counts[folder] = (counts[folder] || 0) + count;
        if (fileSeverity) {
          const current = severities[folder];
          if (!current || SEVERITY_ORDER.indexOf(fileSeverity) < SEVERITY_ORDER.indexOf(current)) {
            severities[folder] = fileSeverity;
          }
        }
      }
    }
    return { folderCounts: counts, folderSeverities: severities };
  }, [relViolationCounts, relViolationSeverities]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tree.children.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <Folder className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No files found in repository.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {selectedPath && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate flex-1">
            Filter: <span className="font-medium text-foreground">{selectedPath}</span>
          </span>
          <button
            onClick={() => onSelectPath(null)}
            className="shrink-0 rounded p-0.5 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {tree.children.map((child) => (
          <TreeNodeRow
            key={child.path}
            node={child}
            depth={0}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onOpenFile={onOpenFile}
            violationCounts={relViolationCounts}
            folderCounts={folderCounts}
            violationSeverities={relViolationSeverities}
            folderSeverities={folderSeverities}
            activeItem={activeItem}
            onSetActiveItem={setActiveItem}
            expandedPaths={expandedPaths || new Set()}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
    </div>
  );
}

type TreeNodeRowProps = {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
  onOpenFile?: (path: string, pinned: boolean) => void;
  violationCounts?: Record<string, number>;
  folderCounts?: Record<string, number>;
  violationSeverities?: Record<string, string>;
  folderSeverities?: Record<string, string>;
  activeItem: string | null;
  onSetActiveItem: (path: string | null) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
};

function TreeNodeRow({ node, depth, selectedPath, onSelectPath, onOpenFile, violationCounts, folderCounts, violationSeverities, folderSeverities, activeItem, onSetActiveItem, expandedPaths, onToggleExpand }: TreeNodeRowProps) {
  const isExpanded = !node.isFile && expandedPaths.has(node.path);

  const violationCount = node.isFile
    ? violationCounts?.[node.path] || 0
    : folderCounts?.[node.path] || 0;

  const severity = node.isFile
    ? violationSeverities?.[node.path]
    : folderSeverities?.[node.path];
  const severityColor = severity ? SEVERITY_COLORS[severity] : undefined;

  const isSelected = activeItem === node.path;

  const handleClick = useCallback(() => {
    onSetActiveItem(node.path);
    if (node.isFile) {
      // Single-click on file = preview (unpinned)
      if (onOpenFile) {
        onOpenFile(node.path, false);
      }
    } else {
      // Single-click on folder = toggle expand/collapse
      onToggleExpand(node.path);
    }
  }, [node.path, node.isFile, onOpenFile, onSetActiveItem, onToggleExpand]);

  const handleDoubleClick = useCallback(() => {
    if (node.isFile && onOpenFile) {
      // Double-click on file = pin (open permanently)
      onOpenFile(node.path, true);
    }
  }, [node.path, node.isFile, onOpenFile]);

  const isFocused = selectedPath === node.path;

  const handleFocusClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectPath(isFocused ? null : node.path);
  }, [node.path, isFocused, onSelectPath]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.path);
  }, [node.path, onToggleExpand]);

  return (
    <div>
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`group flex w-full items-center gap-1.5 px-2 py-1 text-[13px] transition-colors cursor-pointer select-none ${
          isSelected
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {/* Chevron for folders */}
        {!node.isFile ? (
          <span
            onClick={handleChevronClick}
            className="shrink-0 flex items-center justify-center w-4 h-4"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* Name — colored by highest violation severity */}
        <span
          className="truncate flex-1 text-left"
          style={severityColor ? { color: severityColor } : undefined}
        >
          {node.name}
        </span>

        {/* Focus button — filters/highlights graph nodes */}
        <button
          onClick={handleFocusClick}
          className={`shrink-0 rounded p-0.5 transition-colors ${
            isFocused
              ? 'text-foreground'
              : 'text-muted-foreground/0 group-hover:text-muted-foreground hover:bg-muted'
          }`}
          title={isFocused ? 'Clear graph filter' : 'Focus in graph'}
        >
          <Crosshair className="h-3 w-3" />
        </button>
      </div>

      {/* Children */}
      {!node.isFile && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              onOpenFile={onOpenFile}
              violationCounts={violationCounts}
              folderCounts={folderCounts}
              violationSeverities={violationSeverities}
              folderSeverities={folderSeverities}
              activeItem={activeItem}
              onSetActiveItem={onSetActiveItem}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
