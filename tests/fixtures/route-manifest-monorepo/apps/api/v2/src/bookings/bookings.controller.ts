// Fixture Nest controller. With `setGlobalPrefix('v2')` in main.ts it declares
// /v2/bookings and /v2/bookings/{id}.
import { Controller, Get } from '@nestjs/common'

@Controller('bookings')
export class BookingsController {
  @Get()
  list(): unknown[] {
    return []
  }

  @Get(':id')
  get(): unknown {
    return {}
  }
}
