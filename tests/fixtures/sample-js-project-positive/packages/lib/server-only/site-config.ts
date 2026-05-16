
declare type TSiteConfig = { id: 'theme'; value: { primaryColor: string } } | { id: 'branding'; value: { logoUrl: string } };
declare function findConfig(id: string): Promise<{ id: string; rawValue: unknown }>;

export const getSiteConfig = async <
  T extends TSiteConfig['id'],
  U = Extract<TSiteConfig, { id: T }>
>(options: { id: T }): Promise<U> => {
  const record = await findConfig(options.id);
  return record as unknown as U;
};
