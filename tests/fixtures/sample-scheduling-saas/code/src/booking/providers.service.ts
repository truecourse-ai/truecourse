import { ApiError } from '../shared/errors.js';
import { providersRepo } from '../shared/repos/providers.repo.js';
import { slotsRepo } from '../shared/repos/slots.repo.js';

/** Default availability window when the caller doesn't pass `from`/`to`. */
const DEFAULT_WINDOW_DAYS = 14;

export const providersService = {
  /** List bookable providers. */
  list() {
    return providersRepo.list();
  },

  /** Open slots for one provider over a UTC window (defaults to 14 days). */
  async openSlots(providerId: string, from?: Date, to?: Date) {
    const provider = await providersRepo.findById(providerId);
    if (!provider) {
      throw new ApiError(404, 'provider_not_found', 'No such provider');
    }
    const start = from ?? new Date();
    const end = to ?? new Date(start.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
    return slotsRepo.openForProvider(providerId, start, end);
  },
};
