import type { PriorityLevel } from '@mitaller/types';

export const priorityLabels: Record<PriorityLevel, string> = {
  CRITICAL: 'CRITICO',
  HIGH: 'ALTA',
  NORMAL: 'NORMAL',
  LOW: 'BAJA',
  BLOCKED: 'BLOQUEADO'
};

export const priorityColors: Record<PriorityLevel, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  NORMAL: '#2563eb',
  LOW: '#64748b',
  BLOCKED: '#7f1d1d'
};

export function formatDeadline(value: string | Date | null | undefined): string {
  if (!value) return 'Sin deadline';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}
