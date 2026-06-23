/**
 * Positive fixture for code-quality/deterministic/explicit-any-in-return
 * (and the sibling code-quality/deterministic/no-explicit-any).
 *
 * Visitor-pattern dispatch methods (`visit`, `visitChildren`, `visit<Node>`)
 * return `any` because the visitor interface they implement fixes the return
 * type — the author cannot narrow it. Both the explicit-any-in-return rule and
 * the no-explicit-any rule must treat these interface-imposed `any` returns as
 * acceptable. (This is the shape emitted by parser-generator visitor base
 * classes.)
 */

interface TreeNode {
  kind: string;
  children: TreeNode[];
}

export class TreeWalker {
  visit(node: TreeNode): any {
    return node.children.length === 0 ? node.kind : this.visitChildren(node);
  }

  visitChildren(node: TreeNode): any {
    return node.children.map((child) => this.visit(child));
  }
}
