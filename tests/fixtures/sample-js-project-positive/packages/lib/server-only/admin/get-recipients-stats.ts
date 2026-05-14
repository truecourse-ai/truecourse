
declare const DeliveryStatus: { DELIVERED: 'DELIVERED'; PENDING: 'PENDING'; FAILED: 'FAILED' };
declare const EngagementStatus: { CLICKED: 'CLICKED'; OPENED: 'OPENED'; IGNORED: 'IGNORED' };
declare function queryGroupedStats(): Array<{ deliveryStatus: string; engagementStatus: string; _count: number }>;

async function getEmailStats() {
  const results = queryGroupedStats();

  const stats: Record<string, number> = {
    TOTAL: 0,
    [DeliveryStatus.DELIVERED]: 0,
    [DeliveryStatus.PENDING]: 0,
    [DeliveryStatus.FAILED]: 0,
    [EngagementStatus.CLICKED]: 0,
    [EngagementStatus.OPENED]: 0,
    [EngagementStatus.IGNORED]: 0,
  };

  results.forEach((result) => {
    const { deliveryStatus, engagementStatus, _count } = result;

    stats[deliveryStatus] += _count;
    stats[engagementStatus] += _count;
    stats.TOTAL += _count;
  });

  return stats;
}



declare const NotificationStatus: { SENT: 'SENT'; QUEUED: 'QUEUED'; BOUNCED: 'BOUNCED' };
declare function queryNotificationGroups(): Array<{ sendStatus: string; _count: number }>;

async function getNotificationStats() {
  const results = queryNotificationGroups();

  const stats: Record<string, number> = {
    TOTAL: 0,
    [NotificationStatus.SENT]: 0,
    [NotificationStatus.QUEUED]: 0,
    [NotificationStatus.BOUNCED]: 0,
  };

  results.forEach((result) => {
    const { sendStatus, _count } = result;
    stats[sendStatus] += _count;
    stats.TOTAL += _count;
  });

  return stats;
}



declare const SignatureStatus: { COMPLETED: 'COMPLETED'; PENDING: 'PENDING'; DECLINED: 'DECLINED' };
declare function querySignatureGroups(): Array<{ signingStatus: string; _count: number }>;

async function getSignatureStats() {
  const results = querySignatureGroups();

  const stats: Record<string, number> = {
    TOTAL: 0,
    [SignatureStatus.COMPLETED]: 0,
    [SignatureStatus.PENDING]: 0,
    [SignatureStatus.DECLINED]: 0,
  };

  results.forEach((result) => {
    const { signingStatus, _count } = result;
    stats[signingStatus] += _count;
    stats.TOTAL += _count;
  });

  return stats;
}
