
declare function processTemplateDirectly(templateId: string, recipientEmail: string): Promise<{ envelopeId: string }>;
declare function postMessageToParent(data: Record<string, string>): void;

async function handleDirectTemplateSubmit(templateId: string, recipientEmail: string): Promise<void> {
  try {
    const result = await processTemplateDirectly(templateId, recipientEmail);
    postMessageToParent({ type: 'success', envelopeId: result.envelopeId });
  } catch (err) {
    postMessageToParent({ type: 'error', message: String(err) });
  }
}
