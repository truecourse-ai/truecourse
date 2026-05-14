
// Rule fires on the deprecated declaration, not on a consumer calling a deprecated API
declare const authenticatedProcedure: any;
declare const legacyCreateMeta: any;
declare const ZLegacyCreateRequestSchema: any;
declare const ZLegacyCreateResponseSchema: any;

/**
 * Temporary endpoint for V2 Beta — will be removed once the new resource creation flow is released.
 *
 * @public
 * @deprecated
 */
export const createResourceLegacyRoute = authenticatedProcedure
  .meta(legacyCreateMeta)
  .input(ZLegacyCreateRequestSchema)
  .output(ZLegacyCreateResponseSchema)
  .mutation(async ({ input, ctx }: { input: any; ctx: any }) => {
    return { resourceId: 'legacy-id' };
  });
