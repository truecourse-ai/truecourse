
// count > 99 is the standard notification badge cap — the '99+' display pattern is industry-standard
declare const unreadCount: number;

const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);
