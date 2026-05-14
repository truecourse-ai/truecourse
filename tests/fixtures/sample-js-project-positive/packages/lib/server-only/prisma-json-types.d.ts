
// TypeScript type alias inside declare global namespace block — legitimate global type augmentation
declare type TUserPreferences = { theme: 'light' | 'dark'; language: string };
declare type TNotificationSettings = { email: boolean; sms: boolean };

declare global {
  namespace PrismaJson {
    type UserPreferences = TUserPreferences;
    type NotificationSettings = TNotificationSettings;
  }
}


// Aliases inside declare global { namespace PrismaJson } are required by prisma-json-types-generator
// to bind JSON column types — removing them breaks the type augmentation
declare global {
  namespace PrismaJson {
    type EnvelopeAttachmentStatus = 'original' | 'sealed' | 'pending';
    type SignerFieldMeta = Record<string, string | boolean | number>;
    type EnvelopeMetadata = { title?: string; externalId?: string; [key: string]: unknown };
  }
}

