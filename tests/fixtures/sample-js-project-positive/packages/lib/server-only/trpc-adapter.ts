
// Library-framework-contract: TRouter extends a well-known library type (GatewayRouter)
declare interface GatewayRouter { _type: 'gateway-router' }
declare interface GatewayHandlerOptions<TRouter extends GatewayRouter> { router: TRouter; basePath: string }
declare function createGatewayFetchHandler<TRouter extends GatewayRouter>(
  opts: GatewayHandlerOptions<TRouter>
): (req: Request) => Promise<Response>;

export type CreateRestHandlerOptions<TRouter extends GatewayRouter> = Omit<
  GatewayHandlerOptions<TRouter>,
  'basePath'
> & {
  req: Request;
  endpoint: `/${string}`;
};

export const createRestHandler = async <TRouter extends GatewayRouter>(
  opts: CreateRestHandlerOptions<TRouter>,
): Promise<Response> => {
  return createGatewayFetchHandler({ ...opts, basePath: opts.endpoint })(opts.req);
};
