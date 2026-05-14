declare function alphaid(size: number): string;
declare function slugify(name: string): string;
declare const path: { parse: (f: string) => { name: string; ext: string } };

function buildStorageKey(fileName: string): string {
  const { name, ext } = path.parse(fileName);
  const slugified = slugify(name) || alphaid(8);
  const key = `${alphaid(12)}/${slugified}${ext}`;
  return key;
}
