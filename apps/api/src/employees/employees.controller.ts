import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { EmployeesService } from './employees.service';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list() {
    return this.employees.list();
  }

  @Post()
  create(@Body() body: {
    name?: string;
    role?: string | null;
    hourlyRate?: number;
    orderBonusRate?: number;
    marginShareRate?: number;
    notes?: string | null;
  }) {
    return this.employees.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: {
    name?: string;
    role?: string | null;
    active?: boolean;
    hourlyRate?: number;
    orderBonusRate?: number;
    marginShareRate?: number;
    notes?: string | null;
  }) {
    return this.employees.update(id, body);
  }

  @Post(':id/clock-in')
  clockIn(@Param('id') id: string) {
    return this.employees.clockIn(id);
  }

  @Post(':id/clock-out')
  clockOut(@Param('id') id: string, @Body() body: { breakMinutes?: number }) {
    return this.employees.clockOut(id, body.breakMinutes);
  }

  @Post(':id/orders')
  assignOrder(@Param('id') id: string, @Body() body: {
    orderId?: string;
    orderNumber?: string;
    role?: string;
    units?: number;
    minutesSpent?: number;
  }) {
    return this.employees.assignOrder(id, body);
  }

  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.employees.summary(from, to);
  }
}
