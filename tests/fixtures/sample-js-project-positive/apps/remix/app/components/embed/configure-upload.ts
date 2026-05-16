
// Pass-through: catch(error) passes error to console.error as argument
async function handleFileUpload(file: File): Promise<string> {
  try {
    const result = await uploadFileToStorage(file);
    return result.url;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

interface UploadResult { url: string; }
declare function uploadFileToStorage(file: File): Promise<UploadResult>;
