export async function fetchData_70e39130(url: string): Promise<unknown> {
  const r = await fetch(url);
  return r.json();
}
