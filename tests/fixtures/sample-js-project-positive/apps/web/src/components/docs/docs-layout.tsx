interface PageNode {
  type: 'page' | 'folder';
  url?: string;
  children?: PageNode[];
}

function getFirstPageUrl(nodes: PageNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'page') {
      return node.url;
    }
    if (node.type === 'folder' && node.children && node.children.length > 0) {
      const url = getFirstPageUrl(node.children);
      if (url) {
        return url;
      }
    }
  }
  return undefined;
}

export function resolveDocsEntryUrl(sections: PageNode[]): string {
  const url = getFirstPageUrl(sections);
  return url ?? '/docs';
}
