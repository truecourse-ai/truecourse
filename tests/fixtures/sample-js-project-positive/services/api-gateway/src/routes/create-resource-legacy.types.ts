
// createResourceLegacyMeta is the declaration of the deprecated route metadata. Rule fires on the declaration site, not on a caller consuming a deprecated API.
import { z } from 'zod';

declare type TrpcRouteMeta = { openapi: { method: string; path: string; summary: string; description: string; tags: string[]; deprecated: boolean } };

/**
 * Temporary endpoint for V2 Beta — will be removed once the new upload flow is released.
 * @deprecated
 */
export const createResourceLegacyMeta: TrpcRouteMeta = {
  openapi: {
    method: 'POST',
    path: '/resource/create/beta',
    summary: 'Create resource (legacy)',
    description: 'Legacy endpoint. Use the new resource creation endpoint once released.',
    tags: ['Resource'],
    deprecated: true,
  },
};
