
// Single char replacement /_/g to display event type labels — trivially ASCII.
export function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, ' ');
}
