// Default parameter values for email template preview/Storybook — real URLs injected by caller.
function DocumentInviteEmail({
  senderName,
  documentTitle,
  signUrl = 'https://app.example.com/sign/preview',
  reviewUrl = 'https://app.example.com/review/preview',
}: {
  senderName: string;
  documentTitle: string;
  signUrl?: string;
  reviewUrl?: string;
}) {
  return (
    <div>
      <p>{senderName} invited you to sign: {documentTitle}</p>
      <a href={signUrl}>Sign Now</a>
      <a href={reviewUrl}>Review First</a>
    </div>
  );
}
export { DocumentInviteEmail };


declare function getAssetUrl(path: string): string;
declare const Img: React.FC<{ src: string; className?: string; alt?: string }>;
declare const Section: React.FC<{ children?: React.ReactNode }>;
declare const Text: React.FC<{ className?: string; children?: React.ReactNode }>;

type ReportStatusEmailProps = {
  recipientName: string;
  reportTitle: string;
  statusType: 'completed' | 'rejected' | 'pending';
};

function ReportStatusEmailTemplate({ recipientName, reportTitle, statusType }: ReportStatusEmailProps) {
  const iconPath = statusType === 'completed' ? '/static/completed.png'
    : statusType === 'rejected' ? '/static/rejected.png'
    : '/static/pending.png';

  return (
    <Section>
      <Img src={getAssetUrl(iconPath)} className="mx-auto my-4" alt={statusType} />
      <Text className="text-center font-semibold">
        Hi {recipientName}, your report "{reportTitle}" is now {statusType}.
      </Text>
    </Section>
  );
}



// argument-type-mismatch: passes number where string expected — genuine TS2345
function buildEmailSubject(documentTitle: string, signerCount: number): string {
  return `${documentTitle} — ${signerCount} signature(s) required`;
}
// TS2345: Argument of type 'boolean' is not assignable to parameter of type 'string'
const _subject = buildEmailSubject(true, 2);

