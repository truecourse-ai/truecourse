
export const renderTemplate = <T extends Record<string, string>>(template: string, variables: T): string => {
  return template.replace(/\{(\S+)\}/g, (_, key) => {
    if (key in variables) {
      return variables[key as keyof T];
    }
    return key;
  });
};
