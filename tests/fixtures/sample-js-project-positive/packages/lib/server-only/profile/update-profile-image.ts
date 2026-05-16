declare const db: {
  avatarImage: { delete: (opts: object) => Promise<void> };
  user: { findFirst: (opts: object) => Promise<{ avatarImageId: string | null } | null> };
};

interface UpdateProfileImageOptions {
  userId: number;
  newImageBytes?: Buffer;
}

export const updateProfileImage = async ({ userId, newImageBytes }: UpdateProfileImageOptions) => {
  const user = await db.user.findFirst({ where: { id: userId } } as object);

  let oldAvatarImageId: string | null | undefined = user?.avatarImageId;

  if (oldAvatarImageId) {
    await db.avatarImage.delete({
      where: { id: oldAvatarImageId },
    } as object);
  }

  return { deleted: !!oldAvatarImageId };
};
