
// shape: async function delegates to another async handler returning a Promise; async for handler signature conformance
declare function handlePendingFileRequest(opts: { version: string; fileId: string }): Promise<Response>;
declare function handleStaticFileRequest(opts: { version: string; fileId: string }): Promise<Response>;

type FileRequestOptions = { version: 'signed' | 'original' | 'pending'; fileId: string };

const handleFileRequest = async (options: FileRequestOptions): Promise<Response> => {
  if (options.version === 'pending') {
    return handlePendingFileRequest(options);
  }

  return handleStaticFileRequest(options);
};


// FP shape: sharp(Buffer.from(bytes, 'base64')) — Buffer.from(string, encoding) is a
// valid overload returning Buffer; processImage(Buffer) is the canonical usage. No type mismatch.
declare function processImage(input: Buffer): {
  resize: (w: number, h: number) => {
    toFormat: (fmt: string, opts: Record<string, unknown>) => {
      toBuffer: () => Promise<Buffer>;
    };
  };
};

export async function resizeContactAvatar(base64Bytes: string): Promise<Buffer> {
  return processImage(Buffer.from(base64Bytes, 'base64'))
    .resize(256, 256)
    .toFormat('webp', { quality: 80 })
    .toBuffer();
}

