
// [unknown-catch-variable] catch(error) — never accessed; returns legacy fallback constant
declare function resolveUserDisplayName(userId: string): Promise<string>;

const DELETED_ACCOUNT_PLACEHOLDER = '[deleted]';

async function getUserDisplayName(userId: string): Promise<string> {
  try {
    return await resolveUserDisplayName(userId);
  } catch (error) {
    return DELETED_ACCOUNT_PLACEHOLDER;
  }
}
