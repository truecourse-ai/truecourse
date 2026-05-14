
// JSON.stringify in a loop where value mutates each iteration — FP shape ae8e2bc70cb5
// allContacts is mutated via mergeContacts each iteration, so stringify cannot be hoisted.
declare function callLLM(messages: any[]): Promise<{ contacts: any[] }>;
declare function mergeContacts(existing: any[], incoming: any[]): any[];

async function detectContactsIterative(pages: string[]): Promise<any[]> {
  let allContacts: any[] = [];
  const messages: any[] = [];

  for (const pageText of pages) {
    messages.push({ role: 'user', content: pageText });

    const result = await callLLM(messages);
    const newContacts = result.contacts ?? [];

    allContacts = mergeContacts(allContacts, newContacts);

    messages.push({
      role: 'assistant',
      content: `Detected contacts: ${JSON.stringify(allContacts)}`,
    });
  }

  return allContacts;
}
