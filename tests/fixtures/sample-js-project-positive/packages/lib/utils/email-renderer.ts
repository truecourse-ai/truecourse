
// Pass-through: console.error(err) then throws new typed Error
async function renderEmailTemplate(templateName: string, data: Record<string, unknown>): Promise<string> {
  try {
    return await compileEmailTemplate(templateName, data);
  } catch (err) {
    console.error(err);
    throw new Error(\`Failed to render email template "\${templateName}"\`);
  }
}

declare function compileEmailTemplate(name: string, data: Record<string, unknown>): Promise<string>;
