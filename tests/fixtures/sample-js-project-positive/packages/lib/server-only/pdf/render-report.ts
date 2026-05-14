
// No outer groupedRows in renderPages scope — only introduced by destructuring the options param
declare class PageGroup { constructor(opts: { margin: number }): void; }

type RenderOptions = {
  groupedRows: PageGroup[][];
  margin: number;
  title: string;
};

export function renderPages(options: RenderOptions): PageGroup[] {
  const { groupedRows, margin, title } = options;
  return groupedRows.map((rows, i) => {
    const page = new PageGroup({ margin });
    console.log(title, i, rows.length);
    return page;
  });
}
