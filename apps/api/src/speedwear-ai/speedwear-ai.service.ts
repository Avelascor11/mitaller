import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CollabStatus, OperationalStatus, PriorityLevel, PurchaseNeedStatus, ShipmentStatus } from '@prisma/client';
import { MetaService } from '../meta/meta.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SpeedwearAiQuestionDto {
  question?: string;
}

type SpeedwearDomain = 'GENERAL' | 'META_ADS' | 'ORDERS' | 'PURCHASING' | 'STOCK' | 'SHIPPING' | 'INFLUENCERS' | 'ECONOMICS';

@Injectable()
export class SpeedwearAiService {
  private readonly logger = new Logger(SpeedwearAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaService
  ) {}

  async ask(body: SpeedwearAiQuestionDto) {
    const question = body?.question?.trim();
    if (!question) throw new BadRequestException('Escribe una pregunta para IA Speedwear');

    const domain = this.classify(question);
    const answer = domain === 'META_ADS'
      ? await this.askMeta(question)
      : await this.askBusiness(domain, question);

    await this.saveExchange(question, answer);
    return answer;
  }

  async chat(limit = 30) {
    const rows = await this.prisma.speedwearAiChatMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(80, Number(limit) || 30))
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      answer: row.answerJson,
      createdAt: row.createdAt.toISOString()
    }));
  }

  async contextSnapshot() {
    return this.buildContext();
  }

  private async askMeta(question: string) {
    const today = new Date().toISOString().slice(0, 10);
    const answer = await this.meta.advisor({ question, from: today, to: today });
    return {
      ...answer,
      domain: 'META_ADS',
      title: 'Meta Ads',
      permissions: ['Leer campañas', 'Leer recomendaciones', 'Previsualizar cambios', 'Aplicar acciones de Meta con confirmación'],
      routedTo: 'Meta Ads'
    };
  }

  private async askBusiness(domain: SpeedwearDomain, question: string) {
    const context = await this.buildContext();
    const domainLabel = this.domainLabel(domain);
    const headline = this.headlineFor(domain, context);
    const nextActions = this.nextActionsFor(domain, context);

    return {
      from: context.today,
      to: context.today,
      question,
      domain,
      title: domainLabel,
      routedTo: domainLabel,
      headline,
      answer: this.answerFor(domain, question, context),
      confidence: 'MEDIUM',
      nextActions,
      metrics: this.metricsFor(domain, context),
      campaigns: [],
      suggestedQuestions: [
        '¿Qué hago primero hoy?',
        '¿Qué pedidos me están quemando?',
        '¿Qué tengo que comprar?',
        '¿Vamos bien de caja?',
        '¿Qué influs tengo que perseguir?'
      ],
      actionSuggestions: [],
      permissions: [
        'Leer pedidos Shopify importados',
        'Leer compras recomendadas',
        'Leer stock y albaranes',
        'Leer envíos y finalizados',
        'Leer caja/banco',
        'Leer influs y colaboraciones',
        'Aplicar acciones solo cuando exista botón de confirmación'
      ]
    };
  }

  private async buildContext() {
    const todayDate = new Date();
    const today = todayDate.toISOString().slice(0, 10);
    const start = new Date(today);
    const tomorrow = new Date(start);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pendingStatuses = [
      OperationalStatus.NEW,
      OperationalStatus.WAITING_STOCK,
      OperationalStatus.WAITING_PRODUCTION,
      OperationalStatus.IN_PRODUCTION,
      OperationalStatus.PRODUCED,
      OperationalStatus.WAITING_PICKING,
      OperationalStatus.PICKED,
      OperationalStatus.BLOCKED
    ];

    const [
      pendingOrders,
      criticalOrders,
      blockedOrders,
      oldPendingOrders,
      readyForShipping,
      labelsCreated,
      shippedToday,
      openPurchaseNeeds,
      purchaseQuantity,
      lowStockItems,
      supplierDrafts,
      bankAccounts,
      openInfluencers,
      awaitingContent,
      fixedExpenses
    ] = await Promise.all([
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses } } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, priorityLevel: PriorityLevel.CRITICAL } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, OR: [{ priorityLevel: PriorityLevel.BLOCKED }, { operationalStatus: OperationalStatus.BLOCKED }, { operationalStatus: OperationalStatus.WAITING_STOCK }] } }),
      this.prisma.order.count({ where: { operationalStatus: { in: pendingStatuses }, orderedAt: { lt: new Date(todayDate.getTime() - 72 * 60 * 60 * 1000) } } }),
      this.prisma.order.count({ where: { operationalStatus: OperationalStatus.READY_FOR_LABEL } }),
      this.prisma.shipment.count({ where: { status: ShipmentStatus.LABEL_CREATED } }),
      this.prisma.shipment.count({ where: { status: { in: [ShipmentStatus.PRINTED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED] }, updatedAt: { gte: start, lt: tomorrow } } }),
      this.prisma.purchaseNeed.count({ where: { status: PurchaseNeedStatus.OPEN, recommendedPurchaseQuantity: { gt: 0 } } }),
      this.prisma.purchaseNeed.aggregate({ _sum: { recommendedPurchaseQuantity: true }, where: { status: PurchaseNeedStatus.OPEN, recommendedPurchaseQuantity: { gt: 0 } } }),
      this.prisma.stockLevel.count({ where: { quantity: { lte: 0 }, stockItem: { type: { in: ['BLANK_GARMENT', 'TRANSFER'] } } } }),
      this.prisma.supplierPurchaseOrder.count({ where: { status: { in: ['DRAFT', 'READY', 'ERROR'] } } }),
      this.prisma.bankAccount.findMany({ select: { name: true, iban: true, currentBalance: true, availableBalance: true, currency: true, balanceUpdatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 4 }),
      this.prisma.influencer.count({ where: { stage: { in: ['PROSPECT', 'CONTACTED', 'NEGOTIATING'] } } }),
      this.prisma.collaboration.count({ where: { status: CollabStatus.AWAITING_CONTENT } }),
      this.prisma.fixedExpense.aggregate({ _sum: { amount: true }, where: { active: true } })
    ]);

    const cash = bankAccounts.reduce((sum, account) => sum + Number(account.currentBalance ?? account.availableBalance ?? 0), 0);
    return {
      today,
      orders: { pending: pendingOrders, critical: criticalOrders, blocked: blockedOrders, old: oldPendingOrders },
      shipping: { ready: readyForShipping, labelsCreated, shippedToday },
      purchasing: { lines: openPurchaseNeeds, units: Number(purchaseQuantity._sum.recommendedPurchaseQuantity ?? 0), supplierDrafts },
      stock: { lowOrEmpty: lowStockItems },
      economics: { cash, currency: bankAccounts[0]?.currency ?? 'EUR', fixedMonthly: Number(fixedExpenses._sum.amount ?? 0), accounts: bankAccounts },
      influencers: { open: openInfluencers, awaitingContent }
    };
  }

  private classify(question: string): SpeedwearDomain {
    const q = question.toLowerCase();
    if (/(meta|ads|campaña|campanas|anuncio|roas|presupuesto|cpm|ctr|pausar|escalar)/.test(q)) return 'META_ADS';
    if (/(pedido|preparar|critico|crítico|shopify|retro|cliente)/.test(q)) return 'ORDERS';
    if (/(compr|proveedor|falk|ross|albaran|albarán|camiseta|sudadera|ropa)/.test(q)) return 'PURCHASING';
    if (/(stock|estanter|dtf|transfer|mala|malas|inventario)/.test(q)) return 'STOCK';
    if (/(envio|envío|sendcloud|etiqueta|tracking|devuelto|devolucion|devolución)/.test(q)) return 'SHIPPING';
    if (/(influ|ugc|creador|colab|contenido|reel|story)/.test(q)) return 'INFLUENCERS';
    if (/(caja|banco|n26|dinero|saldo|gasto|beneficio|alquiler|luz|pagar)/.test(q)) return 'ECONOMICS';
    return 'GENERAL';
  }

  private domainLabel(domain: SpeedwearDomain) {
    const labels: Record<SpeedwearDomain, string> = {
      GENERAL: 'Speedwear',
      META_ADS: 'Meta Ads',
      ORDERS: 'Pedidos',
      PURCHASING: 'Compras',
      STOCK: 'Stock',
      SHIPPING: 'Envíos',
      INFLUENCERS: 'Influs',
      ECONOMICS: 'Caja'
    };
    return labels[domain];
  }

  private headlineFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') return context.orders.critical > 0 ? 'Primero atacaría los críticos' : 'Pedidos bajo control relativo';
    if (domain === 'PURCHASING') return context.purchasing.units > 0 ? 'Hay compra pendiente que revisar' : 'No veo compra urgente abierta';
    if (domain === 'STOCK') return context.stock.lowOrEmpty > 0 ? 'Ojo: hay stock a cero o bajo' : 'Stock sin alertas fuertes';
    if (domain === 'SHIPPING') return context.shipping.ready > 0 || context.shipping.labelsCreated > 0 ? 'Hay trabajo pendiente en envíos' : 'Envíos tranquilos ahora mismo';
    if (domain === 'INFLUENCERS') return context.influencers.awaitingContent > 0 ? 'Toca perseguir contenido UGC' : 'Influs sin urgencia clara';
    if (domain === 'ECONOMICS') return context.economics.cash > 0 ? 'Caja leída, puedo ayudarte a decidir' : 'Caja incompleta o sin saldo leído';
    return 'Te hago una lectura global';
  }

  private answerFor(domain: SpeedwearDomain, question: string, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') {
      return `Ahora mismo hay ${context.orders.pending} pedidos sin cerrar, ${context.orders.critical} críticos y ${context.orders.old} antiguos. Si preguntas qué haría yo: empezaría por los críticos/antiguos, después los bloqueados por stock y dejaría lo fácil para cerrar tanda.`;
    }
    if (domain === 'PURCHASING') {
      return `Compras recomienda ${context.purchasing.units} unidades repartidas en ${context.purchasing.lines} líneas. Si vas a comprar, revisaría primero camisetas/sudaderas con stock proveedor y evitaría mezclarlo con accesorios o bañadores.`;
    }
    if (domain === 'STOCK') {
      return `Veo ${context.stock.lowOrEmpty} referencias de stock base/DTF a cero o bajo. Para que compras cuadre, lo importante es mantener stock real actualizado por albarán o ajuste manual, y que cada pedido tenga bien mapeada su prenda base.`;
    }
    if (domain === 'SHIPPING') {
      return `Hay ${context.shipping.ready} pedidos preparados para etiqueta y ${context.shipping.labelsCreated} etiquetas creadas pendientes de cerrar/escanear. Hoy figuran ${context.shipping.shippedToday} envíos finalizados.`;
    }
    if (domain === 'INFLUENCERS') {
      return `Tienes ${context.influencers.open} influs abiertos y ${context.influencers.awaitingContent} esperando contenido. Yo priorizaría los que ya han recibido pedido: son los que más rápido pueden darte reels/stories.`;
    }
    if (domain === 'ECONOMICS') {
      return `Caja leída aproximada: ${this.money(context.economics.cash, context.economics.currency)}. Gastos fijos activos al mes: ${this.money(context.economics.fixedMonthly, context.economics.currency)}. Para decidir inversiones, miraría caja disponible, pagos próximos y gasto Meta acumulado antes de comprometer más stock.`;
    }
    return `Te leo la foto general: ${context.orders.pending} pedidos pendientes, ${context.purchasing.units} unidades recomendadas para comprar, ${context.shipping.ready} listos para envío, ${context.influencers.awaitingContent} influs esperando contenido y caja aproximada ${this.money(context.economics.cash, context.economics.currency)}. Dime el problema concreto y lo llevo a la sección correcta.`;
  }

  private nextActionsFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    if (domain === 'ORDERS') return ['Filtrar sin preparar por críticos', 'Resolver bloqueados de stock', 'Cerrar pedidos antiguos antes de nuevos'];
    if (domain === 'PURCHASING') return ['Abrir compras proveedor', 'Revisar unidades por talla/color', 'Crear borrador Falk & Ross si cuadra'];
    if (domain === 'STOCK') return ['Actualizar stock real', 'Subir albarán si ha llegado ropa', 'Revisar mapeos de productos raros'];
    if (domain === 'SHIPPING') return ['Crear etiqueta', 'Imprimir', 'Escanear código para finalizar'];
    if (domain === 'INFLUENCERS') return ['Filtrar esperando contenido', 'Enviar recordatorio', 'Marcar recibido cuando llegue el vídeo'];
    if (domain === 'ECONOMICS') return ['Revisar saldo banco', 'Separar ads/gastos fijos', 'No invertir si caja operativa queda justa'];
    return ['Atacar pedidos críticos', 'Revisar compras recomendadas', 'Mirar caja antes de tocar ads'];
  }

  private metricsFor(domain: SpeedwearDomain, context: Awaited<ReturnType<SpeedwearAiService['buildContext']>>) {
    const base = [
      { label: 'Pendientes', value: String(context.orders.pending), tone: context.orders.critical > 0 ? 'red' : 'blue' },
      { label: 'Comprar', value: String(context.purchasing.units), tone: context.purchasing.units > 0 ? 'amber' : 'green' },
      { label: 'Caja', value: this.money(context.economics.cash, context.economics.currency), tone: context.economics.cash > 0 ? 'green' : 'amber' }
    ];
    if (domain === 'SHIPPING') return [{ label: 'Listos envío', value: String(context.shipping.ready), tone: 'blue' }, { label: 'Etiquetas', value: String(context.shipping.labelsCreated), tone: 'amber' }, { label: 'Finalizados hoy', value: String(context.shipping.shippedToday), tone: 'green' }];
    if (domain === 'INFLUENCERS') return [{ label: 'Influs abiertos', value: String(context.influencers.open), tone: 'purple' }, { label: 'Esperando UGC', value: String(context.influencers.awaitingContent), tone: context.influencers.awaitingContent > 0 ? 'amber' : 'green' }];
    return base;
  }

  private async saveExchange(question: string, answer: unknown) {
    try {
      const now = new Date();
      await this.prisma.speedwearAiChatMessage.createMany({
        data: [
          { id: `user-${crypto.randomUUID()}`, role: 'user', text: question, createdAt: now },
          {
            id: `assistant-${crypto.randomUUID()}`,
            role: 'assistant',
            text: (answer as { headline?: string; answer?: string }).headline ?? 'Respuesta IA Speedwear',
            answerJson: answer as object,
            createdAt: new Date(now.getTime() + 1)
          }
        ]
      });
    } catch (error) {
      this.logger.warn(`No se pudo guardar chat IA Speedwear: ${(error as Error).message}`);
    }
  }

  private money(value: number, currency = 'EUR') {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(Number(value || 0));
  }
}
