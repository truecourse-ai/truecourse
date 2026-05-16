
// --- unknown-catch-variable shape: catch(error) console.error with prefix label + re-throw ---
declare function queryFolderTree(userId: string, parentId: string | null): Promise<{ id: string; name: string }[]>;

async function findUserFolders(userId: string, parentId: string | null): Promise<{ id: string; name: string }[]> {
  try {
    return await queryFolderTree(userId, parentId);
  } catch (error) {
    console.error('Error in findUserFolders:', error);
    throw error;
  }
}
