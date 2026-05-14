
// FP shape: async handler function body beginning with guard clause
declare function toast(opts: { variant: string; title: string; description: string }): void;
declare const configuration: { meta: { externalId?: string }; title: string; signers: unknown[] } | null;

const handleFieldsSubmit = async (fields: Array<{ type: string; pageNumber: number }>) => {
  if (!configuration) {
    toast({
      variant: 'destructive',
      title: 'Error',
      description: 'Please configure the document first',
    });
    return;
  }

  const documentExternalId = configuration.meta.externalId;
  console.log(fields, documentExternalId);
};
