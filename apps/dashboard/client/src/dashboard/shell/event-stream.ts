/**
 * The workspace's live stream, once per page.
 *
 * `GET /api/events` carries every frame the server pushes (job progress, a
 * notification, a Context change), and each surface used to open its own
 * EventSource for the one frame it cared about. A browser allows six
 * connections per host across ALL tabs, so a page holding four streams left the
 * ordinary reads queueing behind them. This is the one connection: it opens on
 * the first subscriber, parses each frame once, hands it to every subscriber,
 * and closes when the last one leaves.
 *
 * Degrades to nothing. A runtime without `EventSource` (a static page, a jsdom
 * test) opens none and every subscription is a no-op; the browser reconnects a
 * dropped stream on its own, and one the server closed for good is replaced
 * when the next subscriber arrives.
 */

import type { ServerEvent } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

/** `EventSource.CLOSED` — the state no frame will ever arrive in again. */
const CLOSED = 2;

export type ServerEventHandler = (event: ServerEvent) => void;

const handlers = new Set<ServerEventHandler>();
let source: EventSource | null = null;

function onMessage(e: MessageEvent<string>): void {
  let event: ServerEvent;
  try {
    event = JSON.parse(e.data) as ServerEvent;
  } catch {
    // A frame this client has no reading of changes nothing.
    return;
  }
  for (const handler of [...handlers]) handler(event);
}

function open(): void {
  if (source || typeof EventSource === 'undefined') return;
  try {
    source = new EventSource(`${getServerUrl()}/api/events`, { withCredentials: true });
  } catch {
    source = null;
    return;
  }
  source.addEventListener('message', onMessage);
}

function close(): void {
  if (!source) return;
  source.removeEventListener('message', onMessage);
  source.close();
  source = null;
}

/** Read the page's stream until the returned function is called. */
export function subscribeToServerEvents(handler: ServerEventHandler): () => void {
  handlers.add(handler);
  if (source?.readyState === CLOSED) close();
  open();
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) close();
  };
}
