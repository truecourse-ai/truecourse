
declare class FormDataReader {
  entries(): IterableIterator<[string, string]>;
}

function parseFormData(form: FormDataReader): Record<string, string | string[]> {
  const data: Record<string, string | string[]> = {};

  for (const [key, value] of form.entries()) {
    const normalizedKey = key.endsWith('[]') ? key.slice(0, -2) : key;

    if (data[normalizedKey] === undefined) {
      data[normalizedKey] = value;
    } else if (Array.isArray(data[normalizedKey])) {
      (data[normalizedKey] as string[]).push(value);
    } else {
      data[normalizedKey] = [data[normalizedKey] as string, value];
    }
  }

  return data;
}
