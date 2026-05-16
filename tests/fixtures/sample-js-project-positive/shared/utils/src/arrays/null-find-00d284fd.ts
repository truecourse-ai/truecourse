declare const items: Array<{ id: string; v: number }>;
export function get_00d284fd(id: string): number {
  const found = items.find(i => i.id === id);
  return found.v;
}
