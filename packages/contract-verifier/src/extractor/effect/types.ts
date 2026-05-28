/**
 * Code-side effect extraction output. Each `emit('channel.event', …)` call
 * site (or `emitXxx('channel.event', …)` helper) produces one record. The
 * inference engine groups these into EffectGroup artifacts; a future verify
 * migration can diff them against spec effect-groups.
 */

import type { SourceLocation } from '../../types/index.js';

export interface ExtractedEffect {
  /** The emitted event name, e.g. `order.placed`. */
  event: string;
  /** The emitter receiver when it's a member call (`events.emit` → `events`),
   *  else `event-bus` for a bare `emit*()` helper. Used as the group channel. */
  channel: string;
  source: SourceLocation;
}
