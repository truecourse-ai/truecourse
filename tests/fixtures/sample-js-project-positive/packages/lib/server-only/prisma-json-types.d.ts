
// TypeScript type alias inside declare global namespace block — legitimate global type augmentation
declare type TUserPreferences = { theme: 'light' | 'dark'; language: string };
declare type TNotificationSettings = { email: boolean; sms: boolean };

declare global {
  namespace PrismaJson {
    type UserPreferences = TUserPreferences;
    type NotificationSettings = TNotificationSettings;
  }
}
