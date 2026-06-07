import { Injectable } from '@nestjs/common';

export type PresenceStage = 'BROWSING' | 'LOOKED_UP' | 'SELECTING' | 'SUBMITTING';

interface PresenceEntry {
  sessionId: string;
  stage: PresenceStage;
  orderNumber?: string | null;
  customerEmail?: string | null;
  type?: string | null;
  startedAt: number;
  lastSeen: number;
}

const TTL_MS = 30000; // a visitor is "live" if seen within 30s

@Injectable()
export class ReturnsPresenceService {
  private readonly sessions = new Map<string, PresenceEntry>();

  heartbeat(input: { sessionId: string; stage: PresenceStage; orderNumber?: string | null; customerEmail?: string | null; type?: string | null }) {
    const now = Date.now();
    const existing = this.sessions.get(input.sessionId);
    this.sessions.set(input.sessionId, {
      sessionId: input.sessionId,
      stage: input.stage,
      orderNumber: input.orderNumber ?? existing?.orderNumber ?? null,
      customerEmail: input.customerEmail ?? existing?.customerEmail ?? null,
      type: input.type ?? existing?.type ?? null,
      startedAt: existing?.startedAt ?? now,
      lastSeen: now
    });
    return { ok: true };
  }

  /** Visitor left (e.g. finished / closed tab) — drop immediately. */
  leave(sessionId: string) {
    this.sessions.delete(sessionId);
    return { ok: true };
  }

  private prune() {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, e] of this.sessions) if (e.lastSeen < cutoff) this.sessions.delete(id);
  }

  list() {
    this.prune();
    const now = Date.now();
    const visitors = [...this.sessions.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((e) => ({
        sessionId: e.sessionId,
        stage: e.stage,
        orderNumber: e.orderNumber,
        customerEmail: e.customerEmail,
        type: e.type,
        secondsOnSite: Math.floor((now - e.startedAt) / 1000),
        secondsIdle: Math.floor((now - e.lastSeen) / 1000)
      }));
    const byStage: Record<PresenceStage, number> = { BROWSING: 0, LOOKED_UP: 0, SELECTING: 0, SUBMITTING: 0 };
    for (const v of visitors) byStage[v.stage]++;
    return { total: visitors.length, byStage, visitors };
  }
}
