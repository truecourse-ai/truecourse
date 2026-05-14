// update-avatar.ts — thin server adapter: validates input, calls service
// Line count inflated by type imports and schema boilerplate.

declare const z: {
  object: (shape: Record<string, unknown>) => ZodObj;
  string: () => ZodStr;
  number: () => ZodNum;
  instanceof: (cls: unknown) => ZodInst;
  enum: (values: string[]) => ZodEnm;
  optional: (s: unknown) => ZodOpt;
};
declare class ZodObj { parse(v: unknown): unknown; }
declare class ZodStr { parse(v: unknown): string; min(n: number): ZodStr; max(n: number): ZodStr; }
declare class ZodNum { parse(v: unknown): number; }
declare class ZodInst { parse(v: unknown): unknown; }
declare class ZodEnm { parse(v: unknown): string; }
declare class ZodOpt { parse(v: unknown): unknown; }

declare const prisma: {
  user: {
    findFirst: (opts: { where: { id: number } }) => Promise<UserRecord | null>;
    update: (opts: { where: { id: number }; data: Partial<UserRecord> }) => Promise<UserRecord>;
  };
};

declare function uploadToStorage(file: Blob, path: string): Promise<{ url: string; key: string }>;
declare function deleteFromStorage(key: string): Promise<void>;
declare function resizeImage(file: Blob, opts: { width: number; height: number }): Promise<Blob>;

type UserRecord = {
  id: number;
  email: string;
  avatarImageId?: string;
  avatarUrl?: string;
};

type UpdateAvatarInput = {
  userId: number;
  imageFile: Blob;
  imageType: 'png' | 'jpeg' | 'webp';
};

type UpdateAvatarOutput = {
  avatarUrl: string;
  avatarImageId: string;
};

const ZUpdateAvatarInputSchema = z.object({
  userId: z.number(),
  imageFile: z.instanceof(Blob),
  imageType: z.enum(['png', 'jpeg', 'webp']),
});

export async function updateUserAvatar(rawInput: unknown): Promise<UpdateAvatarOutput> {
  const { userId, imageFile, imageType } = ZUpdateAvatarInputSchema.parse(rawInput) as UpdateAvatarInput;

  const user = await prisma.user.findFirst({ where: { id: userId } });

  if (!user) {
    throw new Error(`User with id ${userId} not found`);
  }

  const resized = await resizeImage(imageFile, { width: 256, height: 256 });
  const storagePath = `avatars/${userId}/avatar.${imageType}`;

  const { url, key } = await uploadToStorage(resized, storagePath);

  if (user.avatarImageId) {
    await deleteFromStorage(user.avatarImageId).catch(() => null);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: url, avatarImageId: key },
  });

  return {
    avatarUrl: updated.avatarUrl!,
    avatarImageId: updated.avatarImageId!,
  };
}
