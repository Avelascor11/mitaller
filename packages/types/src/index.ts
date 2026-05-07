export type Role =
  | 'ADMIN'
  | 'WORKSHOP_MANAGER'
  | 'PRODUCTION'
  | 'PICKING'
  | 'SHIPPING'
  | 'PURCHASING';

export type OperationalStatus =
  | 'NEW'
  | 'WAITING_STOCK'
  | 'WAITING_PRODUCTION'
  | 'IN_PRODUCTION'
  | 'PRODUCED'
  | 'WAITING_PICKING'
  | 'PICKED'
  | 'READY_FOR_LABEL'
  | 'LABEL_CREATED'
  | 'SHIPPED'
  | 'BLOCKED'
  | 'CANCELLED';

export type ProductionTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED' | 'CANCELLED';
export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW' | 'BLOCKED';

export interface WorkshopSummary {
  criticalTasks: number;
  highTasks: number;
  blockedOrders: number;
  readyToPrepare: number;
}
