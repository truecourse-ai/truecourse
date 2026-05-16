
// FP: ResourceVisibilityEnum is imported; z.nativeEnum wrapping is at line 1.
// ES imports are hoisted, so ZResourceVisibilitySchema is not using anything before it's defined.
declare const ResourceVisibilityEnum: { EVERYONE: 'EVERYONE'; MANAGERS: 'MANAGERS'; ADMINS: 'ADMINS' };
declare const z: { nativeEnum: <T extends object>(e: T) => { enum: T } };

export const ZResourceVisibilitySchema = z.nativeEnum(ResourceVisibilityEnum);
export const ResourceVisibility = ZResourceVisibilitySchema.enum;
export type TResourceVisibility = typeof ResourceVisibility[keyof typeof ResourceVisibility];
