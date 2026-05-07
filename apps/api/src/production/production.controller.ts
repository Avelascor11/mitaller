import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ProductionService } from './production.service';

@Controller('production/tasks')
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get()
  findAll() {
    return this.production.findAll();
  }

  @Get('priority-queue')
  priorityQueue() {
    return this.production.priorityQueue();
  }

  @Patch(':id/start')
  start(@Param('id') id: string) {
    return this.production.start(id);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string) {
    return this.production.complete(id);
  }

  @Patch(':id/block')
  block(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.production.block(id, body.reason ?? 'Incidencia sin detalle');
  }
}
