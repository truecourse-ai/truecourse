
// Wave-M06: template.items.map(async (item, i) => {...}) — async map with index param
declare const template: { items: Array<{ id: string; dataId: string; title: string }> };
declare function getDataById(id: string): Promise<{ id: string; content: string }>;

async function processTemplateItems() {
  const results = await Promise.all(
    template.items.map(async (item, i) => {
      const data = await getDataById(item.dataId);
      return {
        index: i,
        itemId: item.id,
        title: item.title,
        content: data.content,
      };
    }),
  );
  return results;
}



// FP shape f844852faf24: Promise.all over async map for template field processing — no type mismatch
declare function isRequiredField(field: { type: string; required: boolean }): boolean;
declare function validateFieldAuth(opts: { authOptions: Record<string, unknown>; fieldType: string }): Promise<{ valid: boolean }>;
declare const templateFields: Array<{ id: string; type: string; required: boolean }>;
declare const signedValues: Array<{ fieldId: string; value: string }>;
declare const docAuthOptions: Record<string, unknown>;

async function processTemplateFields() {
  const createArgs = await Promise.all(
    templateFields.map(async (templateField) => {
      const signedValue = signedValues.find((v) => v.fieldId === templateField.id);

      if (isRequiredField(templateField) && !signedValue) {
        throw new Error('Invalid, missing or changed fields');
      }

      const auth = await validateFieldAuth({
        authOptions: docAuthOptions,
        fieldType: templateField.type,
      });

      return { field: templateField, value: signedValue?.value, auth };
    }),
  );
  return createArgs;
}



// FP shape fb07cc1af203: createManyAndReturn with map() forming DB insert objects — no type mismatch
declare function prefixedId(prefix: string): string;
declare const prisma3: {
  $transaction: <T>(fn: (tx: { workItem: { createManyAndReturn: (a: object) => Promise<Array<{ id: string; title: string; order: number }>> } }) => Promise<T>) => Promise<T>;
};
declare const workspaceItem: { id: string };
declare const itemsToCreate: Array<{ id: string; title: string; dataId: string; placeholders: string[]; order: number }>;

async function createWorkItems() {
  return prisma3.$transaction(async (tx) => {
    const createdItems = await tx.workItem.createManyAndReturn({
      data: itemsToCreate.map((item) => ({
        id: item.id,
        workspaceId: workspaceItem.id,
        title: item.title,
        dataId: item.dataId,
        order: item.order,
      })),
      include: { data: true },
    });

    return createdItems;
  });
}



// FP shape fc23a09c7939: second Promise.all over fieldsToProcess.map() with async find — no type mismatch
declare function isRequired(field: { type: string; required: boolean }): boolean;
declare function getFieldAuth(opts: { options: object; fieldType: string }): Promise<{ allowed: boolean }>;
declare const processableFields: Array<{ id: string; type: string; required: boolean }>;
declare const fieldValues: Array<{ fieldId: string; value: string }>;
declare const authOptions: object;
declare let recipientName: string | undefined;

async function buildDirectRecipientFieldArgs() {
  return Promise.all(
    processableFields.map(async (field) => {
      const fieldValue = fieldValues.find((v) => v.fieldId === field.id);

      if (isRequired(field) && !fieldValue) {
        throw new Error('Invalid, missing or changed fields');
      }

      if (field.type === 'NAME' && recipientName === undefined) {
        recipientName = fieldValue?.value;
      }

      const auth = await getFieldAuth({
        options: authOptions,
        fieldType: field.type,
      });

      return { field, value: fieldValue, auth };
    }),
  );
}
