
// type: 'templateId' discriminant in an id lookup object — typed ID variant pattern
declare function getEnvelopeById(args: { id: { type: string; id: string } }): Promise<unknown>;

async function loadTemplateEnvelope(templateId: string) {
  return getEnvelopeById({
    id: {
      type: 'templateId',
      id: templateId,
    },
  });
}



// type: 'envelopeId' discriminant in an id lookup object — typed ID variant pattern
declare function getEnvelopeById(args: { id: { type: string; id: string }; type?: string }): Promise<unknown>;

async function loadEnvelopeAsTemplate(envelopeId: string) {
  return getEnvelopeById({
    id: {
      type: 'envelopeId',
      id: envelopeId,
    },
    type: 'TEMPLATE',
  });
}
