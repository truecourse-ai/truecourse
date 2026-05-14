
declare const config: { baseUrl: string };

function buildDownloadUrl(fileId: string, token: string | null) {
  return `${config.baseUrl}/files/${fileId}${token ? `?accessToken=${token}` : ''}`;
}

function buildPreviewUrl(fileId: string, previewToken: string | undefined) {
  return `${config.baseUrl}/preview/${fileId}${previewToken ? `?presignToken=${previewToken}` : ''}`;
}



declare const apiBase: string;

function buildSignedDownloadUrl(documentId: string, presignToken: string | undefined) {
  // Nested template in ternary for optional query param — idiomatic URL construction
  return `${apiBase}/documents/${documentId}/download${presignToken ? `?presignToken=${presignToken}` : ''}`;
}
