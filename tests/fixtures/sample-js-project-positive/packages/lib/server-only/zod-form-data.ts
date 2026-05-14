
declare type ZodRawShape = Record<string, { parse: (v: unknown) => unknown }>;
declare function zodObject<T extends ZodRawShape>(shape: T): { parse: (data: unknown) => Record<string, unknown> };

export const zodFormData = <T extends ZodRawShape>(schema: T) => {
  return {
    parse: (data: unknown) => {
      const formData: Record<string, unknown> = {};
      if (data instanceof FormData) {
        for (const key of data.keys()) {
          formData[key] = data.getAll(key);
        }
      }
      return zodObject(schema).parse(formData);
    },
  };
};
