// Imported by ./trpc.ts, ../react/index.tsx, and ../client/index.ts via relative specifiers
// dead-module rule fails to traverse relative intra-package imports

export interface Transformer {
  serialize: (data: unknown) => unknown;
  deserialize: (data: unknown) => unknown;
}

export const dataTransformer: Transformer = {
  serialize: (data: unknown) => {
    if (data instanceof Date) return { __type: 'Date', value: data.toISOString() };
    return data;
  },
  deserialize: (data: unknown) => {
    if (data && typeof data === 'object' && (data as Record<string, unknown>).__type === 'Date') {
      return new Date((data as Record<string, unknown>).value as string);
    }
    return data;
  },
};
