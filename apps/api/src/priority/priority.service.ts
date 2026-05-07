import { Injectable } from '@nestjs/common';
import { OperationalStatus, PriorityLevel } from '@prisma/client';

export interface PriorityOrderInput {
  orderedAt: Date;
  shippingMethod: string;
  financialStatus: string;
  operationalStatus?: OperationalStatus | string;
  hasMissingStock?: boolean;
  hasIncident?: boolean;
  isProduced?: boolean;
}

@Injectable()
export class PriorityService {
  calculate(input: PriorityOrderInput, now = new Date()) {
    const internalDeadlineAt = this.calculateDeadline(input.orderedAt, input.shippingMethod);
    const method = input.shippingMethod.toLowerCase();

    if (input.operationalStatus === OperationalStatus.CANCELLED) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.BLOCKED, operationalStatus: OperationalStatus.CANCELLED };
    }

    if (input.hasIncident) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.BLOCKED, operationalStatus: OperationalStatus.BLOCKED };
    }

    if (input.hasMissingStock) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.BLOCKED, operationalStatus: OperationalStatus.WAITING_STOCK };
    }

    if (method.includes('express') || method.includes('premium') || method.includes('urgente') || method.includes('same day')) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.CRITICAL, operationalStatus: OperationalStatus.WAITING_PRODUCTION };
    }

    if (this.isSameBusinessDay(internalDeadlineAt, now)) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.CRITICAL, operationalStatus: OperationalStatus.WAITING_PRODUCTION };
    }

    const ageHours = (now.getTime() - input.orderedAt.getTime()) / 36e5;
    if ((internalDeadlineAt < now || ageHours > 24) && !input.isProduced) {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.HIGH, operationalStatus: OperationalStatus.WAITING_PRODUCTION };
    }

    if (input.financialStatus.toLowerCase() !== 'paid') {
      return { internalDeadlineAt, priorityLevel: PriorityLevel.LOW, operationalStatus: OperationalStatus.NEW };
    }

    return { internalDeadlineAt, priorityLevel: PriorityLevel.NORMAL, operationalStatus: OperationalStatus.WAITING_PRODUCTION };
  }

  calculateDeadline(orderedAt: Date, shippingMethod: string) {
    const method = shippingMethod.toLowerCase();
    const hours = method.includes('express') || method.includes('urgente') ? 8 : method.includes('premium') ? 24 : method.includes('recogida') ? 72 : 48;
    return new Date(orderedAt.getTime() + hours * 60 * 60 * 1000);
  }

  private isSameBusinessDay(left: Date, right: Date) {
    return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
  }
}
