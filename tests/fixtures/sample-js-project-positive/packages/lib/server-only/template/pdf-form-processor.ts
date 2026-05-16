declare function insertFormValues(opts: { pdf: Buffer; formValues: Record<string, string> }): Promise<Buffer>;
declare function getFileBuffer(dataId: string): Promise<Buffer>;

interface ProcessPdfOptions {
  documentDataId: string;
  formValues?: Record<string, string>;
}

export const processPdfWithFormValues = async ({ documentDataId, formValues }: ProcessPdfOptions) => {
  let buffer = await getFileBuffer(documentDataId);

  if (formValues) {
    buffer = await insertFormValues({
      pdf: buffer,
      formValues,
    });
  }

  return buffer;
};
