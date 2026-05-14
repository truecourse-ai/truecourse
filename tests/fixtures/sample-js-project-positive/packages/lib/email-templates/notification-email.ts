
declare function getAssetUrl(path: string): string;
declare const Img: React.FC<{ src: string; className?: string; alt?: string }>;
declare const Section: React.FC<{ children?: React.ReactNode }>;
declare const Text: React.FC<{ className?: string; children?: React.ReactNode }>;

type NotificationEmailProps = {
  recipientName: string;
  actionUrl: string;
  assetBaseUrl: string;
  notificationType: 'approved' | 'rejected' | 'pending';
};

function NotificationEmailTemplate({ recipientName, actionUrl, assetBaseUrl, notificationType }: NotificationEmailProps) {
  const iconPath = notificationType === 'approved' ? '/static/approved.png'
    : notificationType === 'rejected' ? '/static/rejected.png'
    : '/static/pending.png';

  return (
    <Section>
      <Img src={getAssetUrl(iconPath)} className="mx-auto my-4" alt={notificationType} />
      <Text className="text-center font-semibold">
        Hello {recipientName}, your request has been {notificationType}.
      </Text>
    </Section>
  );
}
