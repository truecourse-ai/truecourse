
declare const React: { createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => unknown };
declare const documents: Array<{ id: string; title: string; publicDescription: string; slug: string }>;
declare function TableRow(props: { key: string; children?: unknown }): unknown;
declare function TableCell(props: { children?: unknown }): unknown;

function renderDocumentRows() {
  return documents.map((document) =>
    TableRow({
      key: document.id,
      children: TableCell({ children: document.title }),
    }),
  );
}
