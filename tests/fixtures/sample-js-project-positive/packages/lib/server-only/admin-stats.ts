// enum-exhaustive-record-lookup: Record keyed by enum, key from DB groupBy result
enum DeliveryStatus {
  QUEUED = 'QUEUED',
  DELIVERED = 'DELIVERED',
  BOUNCED = 'BOUNCED',
  FAILED = 'FAILED',
}

declare function getDeliveryGroups(): Promise<{ deliveryStatus: DeliveryStatus; _count: number }[]>;

async function computeDeliveryStats() {
  const results = await getDeliveryGroups();

  const stats: Record<DeliveryStatus, number> = {
    [DeliveryStatus.QUEUED]: 0,
    [DeliveryStatus.DELIVERED]: 0,
    [DeliveryStatus.BOUNCED]: 0,
    [DeliveryStatus.FAILED]: 0,
  };

  results.forEach((result) => {
    const { deliveryStatus, _count } = result;
    stats[deliveryStatus] += _count;
  });

  return stats;
}


// enum-exhaustive-record-lookup: stats[signingStatus] where stats keyed by SigningStatus enum
enum ApprovalStatus {
  APPROVED = 'APPROVED',
  PENDING = 'PENDING',
  REJECTED = 'REJECTED',
}

declare function getApprovalGroups(): Promise<{ approvalStatus: ApprovalStatus; _count: number }[]>;

async function computeApprovalStats() {
  const results = await getApprovalGroups();

  const stats: Record<ApprovalStatus, number> = {
    [ApprovalStatus.APPROVED]: 0,
    [ApprovalStatus.PENDING]: 0,
    [ApprovalStatus.REJECTED]: 0,
  };

  results.forEach((result) => {
    const { approvalStatus, _count } = result;
    stats[approvalStatus] += _count;
  });

  return stats;
}
