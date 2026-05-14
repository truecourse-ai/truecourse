
import type * as NavigationTree from './navigation-tree-types';

export function buildNavigation(tree: NavigationTree.RootNode): NavigationTree.FlatNode[] {
  const flatNodes: NavigationTree.FlatNode[] = [];

  function flatten(node: NavigationTree.TreeNode, depth: number): void {
    flatNodes.push({ id: node.id, label: node.label, depth });
    for (const child of node.children ?? []) {
      flatten(child, depth + 1);
    }
  }

  for (const child of tree.children ?? []) {
    flatten(child, 0);
  }

  return flatNodes;
}



import * as TabComponents from './tab-component-exports';

// Spread the full namespace into a unified component map
const componentRegistry = {
  ...TabComponents,
  displayName: 'TabRegistry',
};

export { componentRegistry };



import type * as ContentTree from './content-tree-types';

export function getDocumentationLayout(
  tree: ContentTree.RootNode,
  currentPath: string,
): ContentTree.LayoutNode {
  const currentNode = findNodeByPath(tree, currentPath);

  return {
    prev: currentNode?.prev ?? null,
    next: currentNode?.next ?? null,
    breadcrumbs: currentNode?.breadcrumbs ?? [],
    toc: currentNode?.toc ?? [],
  };
}

declare function findNodeByPath(
  tree: ContentTree.RootNode,
  path: string,
): ContentTree.NavigationNode | null;
