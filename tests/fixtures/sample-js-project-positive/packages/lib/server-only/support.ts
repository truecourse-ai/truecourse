
declare const env: { SUPPORT_EMAIL: string };

function buildSupportEmailBody(userId: string, plan: string | null, subject: string) {
  const planSegment = plan ? `?plan=${plan}` : '';
  const body = `User ${userId} submitted a support ticket.
Subject: ${subject}
Manage: ${env.SUPPORT_EMAIL}/users/${userId}${planSegment}`;
  return body;
}
