
type WorkflowField = { id: string; page: number; positionX: number; positionY: number; width: number; height: number; formId?: string };
type SetFieldsResult = { fields: WorkflowField[] };

declare function setFieldsForWorkflow(opts: { workflowId: string; fields: unknown[] }): Promise<SetFieldsResult>;

async function processWorkflowFields(workflowId: string, rawFields: WorkflowField[]) {
  const result = await setFieldsForWorkflow({
    workflowId,
    fields: rawFields.map((field) => ({
      ...field,
      pageNumber: field.page,
      pageX: field.positionX,
      pageY: field.positionY,
      pageWidth: field.width,
      pageHeight: field.height,
    })),
  });

  return {
    data: result.fields.map((field) => ({
      ...field,
      formId: field.formId,
    })),
  };
}
