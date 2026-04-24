export type FileTreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: FileTreeNode[];
};

/**
 * Build a file tree from a flat list of relative file paths (from git ls-files).
 */
export function buildFileTree(files: string[]): FileTreeNode {
  const tree: FileTreeNode = { name: '', path: '', isFile: false, children: [] };

  for (const filePath of files) {
    if (!filePath) continue;
    const parts = filePath.split('/');
    let current = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join('/');

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: currentPath,
          isFile: isLast,
          children: [],
        };
        current.children.push(child);
      }

      current = child;
    }
  }

  // Sort: folders first, then files, alphabetical
  sortTree(tree);

  // Collapse single-child directory chains
  collapseChains(tree);

  return tree;
}

function sortTree(node: FileTreeNode) {
  node.children.sort((a, b) => {
    if (!a.isFile && b.isFile) return -1;
    if (a.isFile && !b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

function collapseChains(node: FileTreeNode) {
  for (let i = 0; i < node.children.length; i++) {
    let child = node.children[i];
    while (!child.isFile && child.children.length === 1 && !child.children[0].isFile) {
      const grandchild = child.children[0];
      child = {
        name: `${child.name}/${grandchild.name}`,
        path: grandchild.path,
        isFile: grandchild.isFile,
        children: grandchild.children,
      };
      node.children[i] = child;
    }
    collapseChains(child);
  }
}
