import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  time: string;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
