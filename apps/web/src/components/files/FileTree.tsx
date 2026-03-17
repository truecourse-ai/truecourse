
import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, Folder, X, Loader2 } from 'lucide-react';
import { buildFileTree, type FileTreeNode } from '@/lib/file-tree';
import * as api from '@/lib/api';

type FileTreeProps = {
  repoId: string;
  selectedPath: string | null;
  onSelectPath: (path: string | null) => void;
};

export function FileTree({ repoId, selectedPath, onSelectPath }: FileTreeProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    api.getFiles(repoId)
      .then((data) => setFiles(data.files))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [repoId]);

  const tree = useMemo(() => buildFileTree(files), [files]);

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
};

function TreeNodeRow({ node, depth, selectedPath, onSelectPath }: TreeNodeRowProps) {
  const [isExpanded, setIsExpanded] = useState(depth < 1);

  const isSelected = selectedPath === node.path;
  const isAncestorOfSelected = selectedPath ? selectedPath.startsWith(node.path + '/') : false;

  const handleClick = useCallback(() => {
    if (node.isFile) {
      onSelectPath(isSelected ? null : node.path);
    } else {
      if (isSelected) {
        onSelectPath(null);
      } else {
        onSelectPath(node.path);
      }
      setIsExpanded(true);
    }
  }, [node.path, node.isFile, isSelected, onSelectPath]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  }, []);

  return (
    <div>
      <button
        onClick={handleClick}
        className={`flex w-full items-center gap-1.5 px-2 py-1 text-[13px] transition-colors ${
          isSelected
            ? 'bg-accent text-accent-foreground'
            : isAncestorOfSelected
              ? 'bg-accent/50 text-foreground'
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

        {/* Name */}
        <span className="truncate">{node.name}</span>
      </button>

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
