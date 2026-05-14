// FP shape: typed object argument to file upload function — no type mismatch
interface FileUploadParams {
  name: string;
  type: string;
  data: Buffer;
  size: number;
}
interface UploadResult { id: string; url: string }
declare function putFileServerSide(params: FileUploadParams): Promise<UploadResult>;

async function storeGeneratedPdf(name: string, pdfBuffer: Buffer): Promise<UploadResult> {
  return putFileServerSide({
    name,
    type: 'application/pdf',
    data: pdfBuffer,
    size: pdfBuffer.length,
  });
}



declare const processedBytes: Uint8Array;
declare function storeFileServerSide(opts: { name: string; type: string; arrayBuffer: () => Promise<Uint8Array> }): Promise<{ fileData: { id: string } }>;

async function uploadProcessedDocument(filename: string) {
  const { fileData } = await storeFileServerSide({
    name: filename,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(processedBytes),
  });
  return fileData.id;
}



// FP shape: function call with object containing template literal name — standard function call
declare function uploadFileToStorage(
  file: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> },
  initialData: string
): Promise<{ fileData: { id: string; url: string } }>;
declare const parsedName: string;
declare const isRejected: boolean;
declare const pdfBytes: ArrayBuffer;
declare const initialData: string;

async function saveSignedDocument() {
  const suffix = isRejected ? '_rejected.pdf' : '_signed.pdf';

  const { fileData } = await uploadFileToStorage(
    {
      name: `${parsedName}${suffix}`,
      type: 'application/pdf',
      arrayBuffer: async () => Promise.resolve(pdfBytes),
    },
    initialData
  );

  return fileData;
}



// env() called with an S3 bucket name key — infrastructure environment variable access
declare function env(key: string): string | undefined;
declare class PutObjectCommand { constructor(opts: { Bucket?: string; Key: string; ContentType: string }): void; }
declare function getSignedUrl(client: unknown, cmd: PutObjectCommand, opts: { expiresIn: number }): Promise<string>;
declare function getS3Client(): unknown;

async function generatePresignedUploadUrl(key: string, contentType: string) {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: env('NEXT_PRIVATE_UPLOAD_BUCKET'),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, command, { expiresIn: 3600 });
}



// shape: ts-pattern .with() async callback delegates to deleteFileFromS3 returning a Promise; async for match callback type conformance
declare function deleteFileFromS3(key: string): Promise<void>;
declare const StorageType: { S3_PATH: 'S3_PATH' };
declare const storageMatch: (val: unknown) => {
  with(pattern: unknown, cb: () => Promise<void>): { otherwise(cb: () => void): Promise<void> }
};

type DeleteFileOptions = {
  type: 'S3_PATH' | 'BYTES';
  data: string;
};

const deleteStorageFile = async ({ type, data }: DeleteFileOptions) => {
  return await storageMatch(type)
    .with(StorageType.S3_PATH, async () => deleteFileFromS3(data))
    .otherwise(() => {
      return;
    });
};
