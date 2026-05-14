
// Pass-through: catch(err) passes err directly to console.error, multiple signing field handlers
async function signInitialsField(fieldId: string, value: string): Promise<void> {
  try {
    await submitInitialsFieldValue(fieldId, value);
  } catch (err) {
    console.error(err);
  }
}

declare function submitInitialsFieldValue(fieldId: string, value: string): Promise<void>;
