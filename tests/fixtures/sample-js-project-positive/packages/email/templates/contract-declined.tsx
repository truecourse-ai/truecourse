// Email template: filename includes 'Template' suffix, export drops it — intentional naming convention.
export function ContractDeclinedEmail({ recipientName, contractTitle }: { recipientName: string; contractTitle: string }) {
  return (
    <div>
      <p>Hi {recipientName},</p>
      <p>The contract "{contractTitle}" has been declined.</p>
    </div>
  );
}
