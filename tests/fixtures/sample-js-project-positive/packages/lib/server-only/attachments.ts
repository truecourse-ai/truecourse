
declare const attachments: Array<File>;
declare function processAttachments(items: Array<{ file: File }>): Promise<void>;

async function prepareAttachments() {
  await processAttachments(
    attachments.map((file) => ({ file })),
  );
}
