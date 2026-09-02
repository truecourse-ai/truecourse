/** The coalesce-then-rerun core now ships with the runner in `@truecourse/jobs`. */
export {
  drainCoalesced,
  enqueueOrPendCoalesced,
  type CoalesceEnqueueDeps,
  type CoalescePendingUpsert,
  type CoalesceRequest,
} from '@truecourse/jobs';
