
// Wave-M10: fetchFileServerSide({type, data}) — fields match expected structure, no type mismatch
declare function fetchFileServerSide(opts: { type: string; data: string }): Promise<Buffer>;
declare const assetRecord: { documentData: { type: string; initialData: string; data: string } };
declare const version: 'current' | 'original';

async function getFileForVersion() {
  const dataToUse = version === 'current' ? assetRecord.documentData.data : assetRecord.documentData.initialData;
  const file = await fetchFileServerSide({
    type: assetRecord.documentData.type,
    data: dataToUse,
  });
  return file;
}
