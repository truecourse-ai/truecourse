declare const fetchA_8ac6cdf5: () => Promise<unknown>;
declare const fetchB_8ac6cdf5: () => Promise<unknown>;
export async function loadBoth_8ac6cdf5(): Promise<unknown[]> {
  return await Promise.all([fetchA_8ac6cdf5(), fetchB_8ac6cdf5()]);
}
