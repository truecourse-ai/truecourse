// Utility: delete a stored file by dispatching to the appropriate backend.
// server-actions.ts is a peer S3 utility with no 'use server' directive —
// it is NOT a Next.js server action module, just a co-located helper.

declare const StorageType: { S3_PATH: 'S3_PATH'; LOCAL_PATH: 'LOCAL_PATH' };
declare function matchStorageType<T>(value: string): { with(type: string, fn: () => Promise<T>): { otherwise(fn: () => T): Promise<T> } };
declare function removeS3Object(key: string): Promise<void>;

export type RemoveFileOptions = {
  type: keyof typeof StorageType;
  data: string;
};

export const removeFile = async ({ type, data }: RemoveFileOptions): Promise<void> => {
  await matchStorageType<void>(type)
    .with(StorageType.S3_PATH, async () => removeObjectFromS3(data))
    .otherwise(() => {
      return;
    });
};

const removeObjectFromS3 = async (key: string): Promise<void> => {
  await removeS3Object(key);
};
