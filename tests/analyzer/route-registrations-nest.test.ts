import { describe, it, expect } from 'vitest'
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations'
import { parseCode } from '../../packages/analyzer/src/parser'

function routesOf(code: string, filePath = '/src/x.controller.ts') {
  const tree = parseCode(code, 'typescript')
  return extractRouteRegistrations(tree, filePath, 'typescript').routes
}

describe('NestJS controller decorators', () => {
  it('composes the controller path with each method path', () => {
    // Shape drawn from cal.com's api/v2 bookings controller.
    const routes = routesOf(`
      @Controller({ path: "/v2/bookings", version: VERSION_2024_08_13_VALUE })
      @UseGuards(PermissionsGuard)
      @DocsTags("Bookings")
      export class BookingsController_2024_08_13 {
        @Post("/")
        @UseGuards(OptionalApiAuthGuard)
        @ApiOperation({ summary: "Create a booking" })
        async createBooking(@Body() body: CreateBookingInput): Promise<CreateBookingOutput> {}

        @Get("/")
        async getBookings(@Query() query: GetBookingsInput) {}

        @Post("/:bookingUid/cancel")
        async cancelBooking(@Param("bookingUid") uid: string) {}

        @Patch("/:bookingUid/location")
        async updateLocation() {}

        @Delete("/:bookingUid")
        async remove() {}
      }
    `)

    expect(routes).toEqual([
      expect.objectContaining({ httpMethod: 'POST', path: '/v2/bookings', handlerName: 'createBooking' }),
      expect.objectContaining({ httpMethod: 'GET', path: '/v2/bookings', handlerName: 'getBookings' }),
      expect.objectContaining({
        httpMethod: 'POST',
        path: '/v2/bookings/:bookingUid/cancel',
        handlerName: 'cancelBooking',
      }),
      expect.objectContaining({
        httpMethod: 'PATCH',
        path: '/v2/bookings/:bookingUid/location',
        handlerName: 'updateLocation',
      }),
      expect.objectContaining({ httpMethod: 'DELETE', path: '/v2/bookings/:bookingUid', handlerName: 'remove' }),
    ])
  })

  it('reads the bare-string controller form and the argument-less method form', () => {
    const routes = routesOf(`
      @Controller('users')
      class UsersController {
        @Get()
        list() {}

        @Get(':id')
        byId() {}
      }
    `)

    expect(routes).toEqual([
      expect.objectContaining({ httpMethod: 'GET', path: '/users', handlerName: 'list' }),
      expect.objectContaining({ httpMethod: 'GET', path: '/users/:id', handlerName: 'byId' }),
    ])
  })

  it('registers every path of an array-valued method decorator', () => {
    const routes = routesOf(`
      @Controller({ path: "/v2/calendars" })
      class C {
        @Get(["/:calendar/events/:eventUid", "/:calendar/event/:eventUid"])
        getEvent() {}
      }
    `)

    expect(routes.map((r) => r.path)).toEqual([
      '/v2/calendars/:calendar/events/:eventUid',
      '/v2/calendars/:calendar/event/:eventUid',
    ])
  })

  it('serves a bare @Controller() at the root', () => {
    const routes = routesOf(`
      @Controller()
      export class AppController {
        @Get("health")
        health() {}
      }
    `)

    expect(routes).toEqual([
      expect.objectContaining({ httpMethod: 'GET', path: '/health', handlerName: 'health' }),
    ])
  })

  it('drops a controller whose base path is not statically known', () => {
    // A half-known address is worse than none: it is not callable and it
    // collides with the real one.
    expect(
      routesOf(`
        @Controller({ path: BASE_PATH })
        class C {
          @Get("/a") a() {}
        }
      `),
    ).toEqual([])

    expect(
      routesOf(`
        @Controller({ path: \`/v2/\${segment}\` })
        class C {
          @Get("/a") a() {}
        }
      `),
    ).toEqual([])
  })

  it('drops a method whose own path is not statically known', () => {
    const routes = routesOf(`
      @Controller({ path: "/v2/x" })
      class C {
        @Get(ROUTE) dynamic() {}
        @Get("/ok") ok() {}
      }
    `)

    expect(routes.map((r) => r.path)).toEqual(['/v2/x/ok'])
  })

  it('ignores HTTP-shaped decorators on a class that is not a controller', () => {
    expect(
      routesOf(`
        @Injectable()
        class NotAController {
          @Get("/settings") settings() {}
        }
      `),
    ).toEqual([])
  })

  it('ignores Nest decorators the route schema has no method for', () => {
    const routes = routesOf(`
      @Controller({ path: "/v2/x" })
      class C {
        @Head("/h") h() {}
        @Options("/o") o() {}
        @Get("/g") g() {}
      }
    `)

    expect(routes.map((r) => r.httpMethod)).toEqual(['GET'])
  })

  it('locates each route at its own decorator, not at the class', () => {
    const routes = routesOf(`
      @Controller({ path: "/v2/x" })
      class C {
        @Get("/a") a() {}

        @Post("/b") b() {}
      }
    `)

    expect(routes[0]!.location.startLine).toBeLessThan(routes[1]!.location.startLine)
    expect(routes[0]!.location.filePath).toBe('/src/x.controller.ts')
  })

  it('reads controllers written in plain JavaScript too', () => {
    const tree = parseCode(
      `
      @Controller('/v2/webhooks')
      class WebhooksController {
        @Post('/') create() {}
      }
    `,
      'javascript',
    )
    const { routes } = extractRouteRegistrations(tree, '/src/webhooks.controller.js', 'javascript')
    expect(routes).toEqual([
      expect.objectContaining({ httpMethod: 'POST', path: '/v2/webhooks', handlerName: 'create' }),
    ])
  })
})
