// enum-exhaustive-record-lookup: STATUS_MAP[status] where status typed as ExtendedStatus enum
type ExtendedStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'DECLINED' | 'EXPIRED';

const STATUS_DISPLAY_MAP: Record<ExtendedStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Draft', color: 'text-gray-500' },
  PENDING: { label: 'Pending', color: 'text-yellow-500' },
  COMPLETED: { label: 'Completed', color: 'text-green-500' },
  DECLINED: { label: 'Declined', color: 'text-red-500' },
  EXPIRED: { label: 'Expired', color: 'text-orange-500' },
};

function getStatusDisplay(status: ExtendedStatus): { label: string; color: string } {
  return STATUS_DISPLAY_MAP[status];
}
