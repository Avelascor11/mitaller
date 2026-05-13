//
//  ContentView.swift
//  Mitaller
//
//  Created by Angel Velasco on 5/5/26.
//

import SwiftUI
import UIKit
import UniformTypeIdentifiers

enum AppTheme {
    // Canvas: deep ink with subtle indigo/teal washes — dark SaaS (Linear/Vercel feel)
    static let canvasTop    = Color(red: 0.043, green: 0.055, blue: 0.094) // #0B0E18
    static let canvasBottom = Color(red: 0.027, green: 0.035, blue: 0.067) // #070911
    static let canvasAccent = Color(red: 0.071, green: 0.078, blue: 0.137) // #121423

    // Surfaces (elevated dark cards)
    static let surface       = Color(red: 0.090, green: 0.106, blue: 0.157) // #171B28 card
    static let surfaceStrong = Color(red: 0.114, green: 0.137, blue: 0.196) // #1D2332 elevated
    static let surfaceSoft   = Color(red: 0.067, green: 0.082, blue: 0.125) // #111521 inner panel
    static let surfaceTinted = Color(red: 0.078, green: 0.094, blue: 0.141) // #141824

    // Text — high contrast on dark
    static let ink       = Color(red: 0.965, green: 0.973, blue: 0.988) // #F6F8FC primary
    static let inkSoft   = Color(red: 0.875, green: 0.890, blue: 0.918) // #DFE3EA
    static let muted     = Color(red: 0.616, green: 0.651, blue: 0.722) // #9DA6B8
    static let mutedSoft = Color(red: 0.482, green: 0.522, blue: 0.604) // #7B859A

    // Lines (subtle dividers, slight lift)
    static let line     = Color.white.opacity(0.08)
    static let lineSoft = Color.white.opacity(0.04)

    // Brand + semantic — saturated, vivid against dark
    static let blue    = Color(red: 0.451, green: 0.420, blue: 0.969) // #736BF7 indigo
    static let blueSoft = Color(red: 0.451, green: 0.420, blue: 0.969).opacity(0.16)
    static let teal    = Color(red: 0.275, green: 0.831, blue: 0.937) // #46D4EF
    static let tealSoft = Color(red: 0.275, green: 0.831, blue: 0.937).opacity(0.16)
    static let amber   = Color(red: 0.984, green: 0.749, blue: 0.286) // #FBBF49
    static let amberSoft = Color(red: 0.984, green: 0.749, blue: 0.286).opacity(0.18)
    static let magenta = Color(red: 0.961, green: 0.404, blue: 0.808) // #F567CE
    static let magentaSoft = Color(red: 0.961, green: 0.404, blue: 0.808).opacity(0.18)
    static let green   = Color(red: 0.318, green: 0.871, blue: 0.604) // #51DE9A
    static let greenSoft = Color(red: 0.318, green: 0.871, blue: 0.604).opacity(0.18)
    static let purple  = Color(red: 0.690, green: 0.490, blue: 0.992) // #B07DFD
    static let purpleSoft = Color(red: 0.690, green: 0.490, blue: 0.992).opacity(0.18)
    static let red     = Color(red: 0.984, green: 0.408, blue: 0.467) // #FB6877
    static let redSoft = Color(red: 0.984, green: 0.408, blue: 0.467).opacity(0.18)
}

enum PriorityLevel: String, CaseIterable, Identifiable {
    case critical = "CRITICO"
    case high = "ALTA"
    case normal = "NORMAL"
    case low = "BAJA"
    case blocked = "BLOQUEADO"

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .critical: AppTheme.red
        case .high: AppTheme.amber
        case .normal: AppTheme.blue
        case .low: AppTheme.muted
        case .blocked: AppTheme.magenta
        }
    }

    var softColor: Color {
        switch self {
        case .critical: AppTheme.redSoft
        case .high: AppTheme.amberSoft
        case .normal: AppTheme.blueSoft
        case .low: AppTheme.surfaceTinted
        case .blocked: AppTheme.magentaSoft
        }
    }

    var sortWeight: Int {
        switch self {
        case .critical: 0
        case .high: 1
        case .normal: 2
        case .low: 3
        case .blocked: 4
        }
    }
}

enum TaskStatus: String {
    case pending = "Pendiente"
    case inProgress = "En fabricacion"
    case done = "Fabricado"
    case blocked = "Bloqueado"
}

enum OrderStatus: String {
    case new = "NEW"
    case waitingProduction = "WAITING_PRODUCTION"
    case inProduction = "IN_PRODUCTION"
    case produced = "PRODUCED"
    case waitingPicking = "WAITING_PICKING"
    case waitingStock = "WAITING_STOCK"
    case picked = "PICKED"
    case readyForLabel = "READY_FOR_LABEL"
    case labelCreated = "LABEL_CREATED"
    case shipped = "SHIPPED"
    case cancelled = "CANCELLED"

    var isPendingPreparation: Bool {
        switch self {
        case .readyForLabel, .labelCreated, .shipped, .cancelled:
            false
        default:
            true
        }
    }

    var label: String {
        switch self {
        case .new: "Nuevo"
        case .waitingProduction: "Sin preparar"
        case .inProduction: "En produccion"
        case .produced: "Fabricado"
        case .waitingPicking: "Pendiente picking"
        case .waitingStock: "Falta stock"
        case .picked: "Picking hecho"
        case .readyForLabel: "Preparado"
        case .labelCreated: "Etiqueta creada"
        case .shipped: "Enviado"
        case .cancelled: "Cancelado"
        }
    }
}

struct WorkshopTask: Identifiable, Hashable {
    let id: UUID
    let remoteID: String?
    let orderRemoteID: String?
    let orderNumber: String
    let productName: String
    let sku: String
    let color: String
    let size: String
    let quantity: Int
    var status: TaskStatus
    var priority: PriorityLevel
    let deadline: String
    var blockedReason: String?

    init(
        id: UUID = UUID(),
        remoteID: String? = nil,
        orderRemoteID: String? = nil,
        orderNumber: String,
        productName: String,
        sku: String,
        color: String = "",
        size: String = "",
        quantity: Int,
        status: TaskStatus = .pending,
        priority: PriorityLevel,
        deadline: String,
        blockedReason: String? = nil
    ) {
        self.id = id
        self.remoteID = remoteID
        self.orderRemoteID = orderRemoteID
        self.orderNumber = orderNumber
        self.productName = productName
        self.sku = sku
        self.color = color
        self.size = size
        self.quantity = quantity
        self.status = status
        self.priority = priority
        self.deadline = deadline
        self.blockedReason = blockedReason
    }
}

struct WorkshopOrderItem: Identifiable, Hashable {
    let id: String
    let title: String
    let variantTitle: String?
    let sku: String
    let quantity: Int
    let imageURL: URL?
    let imageURLs: [URL]

    var displayTitle: String {
        title
    }

    var detailLine: String {
        [variantTitle, sku.isEmpty ? nil : sku].compactMap { $0 }.joined(separator: " · ")
    }

    var sizeText: String {
        if let variantTitle, !variantTitle.isEmpty {
            return variantTitle
        }
        return "Talla"
    }
}

struct WorkshopOrder: Identifiable, Hashable {
    enum Source: String, Hashable {
        case shopify = "Shopify"
        case sheet = "Hoja"

        var icon: String {
            switch self {
            case .shopify: "cart.fill"
            case .sheet: "tablecells.fill"
            }
        }
    }

    enum PrintStatus: String, Hashable {
        case none
        case pending
        case printed

        init(shipments: [ShipmentDTO]) {
            if shipments.contains(where: { $0.status == "PRINTED" }) {
                self = .printed
            } else if shipments.contains(where: { $0.labelUrl != nil || $0.status == "LABEL_CREATED" }) {
                self = .pending
            } else {
                self = .none
            }
        }
    }

    let id = UUID()
    let remoteID: String?
    let number: String
    let customer: String
    let shippingMethod: String
    var status: OrderStatus
    var priority: PriorityLevel
    let deadline: String
    let items: [WorkshopOrderItem]
    var tracking: String?
    let source: Source
    var printStatus: PrintStatus
    let createdAt: Date?
    let preparedAt: Date?

    var hasMultipleItems: Bool { items.count > 1 }
    var totalUnits: Int { items.reduce(0) { $0 + $1.quantity } }

    var shippingCategory: ShippingCategory {
        let value = shippingMethod.folding(options: .diacriticInsensitive, locale: .current).lowercased()
        if value.contains("premium") || value.contains("express") || value.contains("urgente") {
            return .premium
        }
        if value.contains("gratis") || value.contains("gratuito") || value.contains("free") || value.contains("recogida") {
            return .free
        }
        return .standard
    }

    var shippingSortRank: Int {
        switch shippingCategory {
        case .premium: 0
        case .standard: 1
        case .free: 2
        }
    }

    var createdAtShort: String? {
        guard let createdAt else { return nil }
        return createdAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    var createdAtRelative: String? {
        guard let createdAt else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.locale = Locale(identifier: "es_ES")
        return formatter.localizedString(for: createdAt, relativeTo: Date())
    }

    var preparedAtShort: String? {
        guard let preparedAt else { return nil }
        return preparedAt.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    init(
        remoteID: String? = nil,
        number: String,
        customer: String,
        shippingMethod: String,
        status: OrderStatus,
        priority: PriorityLevel,
        deadline: String,
        items: [WorkshopOrderItem],
        tracking: String? = nil,
        source: Source = .shopify,
        printStatus: PrintStatus = .none,
        createdAt: Date? = nil,
        preparedAt: Date? = nil
    ) {
        self.remoteID = remoteID
        self.number = number
        self.customer = customer
        self.shippingMethod = shippingMethod
        self.status = status
        self.priority = priority
        self.deadline = deadline
        self.items = items
        self.tracking = tracking
        self.source = source
        self.printStatus = printStatus
        self.createdAt = createdAt
        self.preparedAt = preparedAt
    }
}

enum ShippingCategory: String {
    case free = "Gratis"
    case standard = "Estandar"
    case premium = "Premium"
}

enum ShippingQueueSort: String, CaseIterable, Identifiable {
    case preparedOldest
    case preparedNewest
    case urgency

    var id: String { rawValue }

    var title: String {
        switch self {
        case .preparedOldest: "Preparados primero"
        case .preparedNewest: "Preparados recientes"
        case .urgency: "Urgencia"
        }
    }

    func sort(_ orders: [WorkshopOrder]) -> [WorkshopOrder] {
        switch self {
        case .preparedOldest:
            orders.sorted {
                let left = $0.preparedAt ?? $0.createdAt ?? .distantFuture
                let right = $1.preparedAt ?? $1.createdAt ?? .distantFuture
                return left == right ? $0.number < $1.number : left < right
            }
        case .preparedNewest:
            orders.sorted {
                let left = $0.preparedAt ?? $0.createdAt ?? .distantPast
                let right = $1.preparedAt ?? $1.createdAt ?? .distantPast
                return left == right ? $0.number > $1.number : left > right
            }
        case .urgency:
            OrderSort.smart.sort(orders)
        }
    }
}

enum ShippingFilter: String, CaseIterable, Identifiable {
    case all
    case standard
    case premium

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "Todos"
        case .standard: "Estandar"
        case .premium: "Premium"
        }
    }

    func matches(_ order: WorkshopOrder) -> Bool {
        switch self {
        case .all: true
        case .standard: order.shippingCategory == .standard
        case .premium: order.shippingCategory == .premium
        }
    }
}

enum ShippingChoice: String, CaseIterable, Identifiable {
    case all = "Todos"
    case premium = "Premium"
    case standard = "Estándar"
    case free = "Gratis"

    var id: String { rawValue }

    var iconName: String {
        switch self {
        case .all: "shippingbox.and.arrow.backward.fill"
        case .premium: "bolt.fill"
        case .standard: "shippingbox.fill"
        case .free: "gift.fill"
        }
    }

    func matches(_ order: WorkshopOrder) -> Bool {
        switch self {
        case .all: true
        case .premium: order.shippingCategory == .premium
        case .standard: order.shippingCategory == .standard
        case .free: order.shippingCategory == .free
        }
    }
}

enum PriorityChoice: String, CaseIterable, Identifiable {
    case all = "Todos"
    case critical = "Críticos"
    case high = "Altos"
    case normal = "Medios"
    case blocked = "Falta stock"

    var id: String { rawValue }

    var iconName: String {
        switch self {
        case .all: "flag"
        case .critical: "flame.fill"
        case .high: "arrow.up.circle.fill"
        case .normal: "circle.fill"
        case .blocked: "exclamationmark.triangle.fill"
        }
    }

    func matches(_ order: WorkshopOrder) -> Bool {
        switch self {
        case .all: true
        case .critical: order.priority == .critical
        case .high: order.priority == .high
        case .normal: order.priority == .normal || order.priority == .low
        case .blocked: order.priority == .blocked || order.status == .waitingStock
        }
    }
}

enum OrderSort: String, CaseIterable, Identifiable {
    case smart = "Inteligente (envío + prioridad)"
    case dateDesc = "Más recientes"
    case dateAsc = "Más antiguos"
    case numberDesc = "Nº pedido ↓"
    case numberAsc = "Nº pedido ↑"
    case customer = "Cliente A→Z"

    var id: String { rawValue }

    var shortLabel: String {
        switch self {
        case .smart: "Inteligente"
        case .dateDesc: "Recientes"
        case .dateAsc: "Antiguos"
        case .numberDesc: "Nº ↓"
        case .numberAsc: "Nº ↑"
        case .customer: "Cliente"
        }
    }

    var iconName: String {
        switch self {
        case .smart: "sparkles"
        case .dateDesc: "arrow.down.circle.fill"
        case .dateAsc: "arrow.up.circle.fill"
        case .numberDesc: "number.circle.fill"
        case .numberAsc: "number.circle"
        case .customer: "person.fill"
        }
    }

    func sort(_ orders: [WorkshopOrder]) -> [WorkshopOrder] {
        switch self {
        case .smart:
            // Premium → Estándar → Gratis, dentro de cada uno: críticos → alto → medio,
            // y a igualdad, más recientes primero.
            return orders.sorted { left, right in
                if left.shippingSortRank != right.shippingSortRank {
                    return left.shippingSortRank < right.shippingSortRank
                }
                if left.priority.sortWeight != right.priority.sortWeight {
                    return left.priority.sortWeight < right.priority.sortWeight
                }
                let lDate = left.createdAt ?? .distantPast
                let rDate = right.createdAt ?? .distantPast
                return lDate > rDate
            }
        case .dateDesc:
            return orders.sorted { (a, b) in
                (a.createdAt ?? .distantPast) > (b.createdAt ?? .distantPast)
            }
        case .dateAsc:
            return orders.sorted { (a, b) in
                (a.createdAt ?? .distantFuture) < (b.createdAt ?? .distantFuture)
            }
        case .numberDesc:
            return orders.sorted { OrderSort.numericValue($0.number) > OrderSort.numericValue($1.number) }
        case .numberAsc:
            return orders.sorted { OrderSort.numericValue($0.number) < OrderSort.numericValue($1.number) }
        case .customer:
            return orders.sorted { $0.customer.localizedCaseInsensitiveCompare($1.customer) == .orderedAscending }
        }
    }

    private static func numericValue(_ number: String) -> Int {
        Int(number.filter(\.isNumber)) ?? 0
    }
}

enum ProductionFilter: String, CaseIterable, Identifiable {
    case all = "Todo"
    case critical = "Críticas"
    case high = "Altas"
    case active = "En curso"

    var id: String { rawValue }

    func matches(_ task: WorkshopTask) -> Bool {
        switch self {
        case .all: true
        case .critical: task.priority == .critical
        case .high: task.priority == .high
        case .active: task.status == .inProgress
        }
    }
}

struct StockRow: Identifiable {
    let id = UUID()
    let sku: String
    let name: String
    let location: String
    let quantity: Int
    let minStock: Int
}

struct PurchaseNeed: Identifiable {
    let id = UUID()
    let supplierSku: String
    let name: String
    let quantity: Int
    let supplierAvailable: Int
}

struct PurchaseMatrixEntry: Identifiable {
    var id: String { size }
    let size: String
    let subproductName: String
    let sku: String?
    let supplierSku: String?
    let stockItemId: String?
    let pendingOrderNeed: Int
    let demandOrders: [PurchaseDemandOrder]
    let currentInternalStock: Int
    let minStockTarget: Int
    let alreadyOrderedQuantity: Int
    let recommendedPurchaseQuantity: Int
    let supplierAvailableQuantity: Int?
}

struct PurchaseDemandOrder: Identifiable, Hashable {
    var id: String { orderItemId }
    let orderId: String
    let orderNumber: String
    let customerName: String
    let orderItemId: String
    let title: String
    let sku: String
    let quantity: Int
}

struct PurchaseMatrixGroup: Identifiable {
    var id: String { key }
    let key: String
    let title: String
    let garmentType: String
    let color: String
    let backgroundHex: String
    let foregroundHex: String
    let entries: [PurchaseMatrixEntry]

    var totalRecommended: Int {
        entries.reduce(0) { $0 + $1.recommendedPurchaseQuantity }
    }

    var totalPending: Int {
        entries.reduce(0) { $0 + $1.pendingOrderNeed }
    }

    var totalStock: Int {
        entries.reduce(0) { $0 + $1.currentInternalStock }
    }
}

@Observable
final class WorkshopStore {
    var apiBaseURL = "https://mitaller-production-4755.up.railway.app"
    var isLoading = false
    var syncError: String?
    var isAPIConnected = false
    var lastSyncText = "Sin sincronizar"
    var labelCreationOrderID: UUID?
    var labelScanOrderID: UUID?
    private var didBootstrap = false
    var tasks: [WorkshopTask] = []
    var orders: [WorkshopOrder] = []
    var stock: [StockRow] = []
    var purchaseNeeds: [PurchaseNeed] = []
    var purchaseMatrix: [PurchaseMatrixGroup] = []
    var mappingWorkbench: MappingWorkbench?
    var orderPickingLists: [String: OrderPickingList] = [:]

    var priorityQueue: [WorkshopTask] {
        tasks
            .filter { $0.status != .done }
            .sorted { left, right in
                if left.priority.sortWeight == right.priority.sortWeight {
                    return left.deadline < right.deadline
                }
                return left.priority.sortWeight < right.priority.sortWeight
            }
    }

    var criticalTasks: Int { tasks.filter { $0.priority == .critical && $0.status != .done }.count }
    var highTasks: Int { tasks.filter { $0.priority == .high && $0.status != .done }.count }
    var blockedOrders: Int { orders.filter { $0.status == .waitingStock || $0.priority == .blocked }.count }
    var readyForShipping: Int { orders.filter { $0.status == .readyForLabel }.count }
    var urgentPendingOrders: Int { pendingPreparationOrders.filter { $0.priority == .critical }.count }
    var highPendingOrders: Int { pendingPreparationOrders.filter { $0.priority == .high }.count }
    var pendingPreparationOrders: [WorkshopOrder] {
        orders
            .filter { $0.status.isPendingPreparation }
            .sorted { left, right in
                if left.priority.sortWeight == right.priority.sortWeight {
                    return left.deadline < right.deadline
                }
                return left.priority.sortWeight < right.priority.sortWeight
            }
    }

    var apiClient: APIClient? {
        guard let url = URL(string: apiBaseURL) else { return nil }
        return APIClient(baseURL: url)
    }

    func bootstrap() async {
        guard !didBootstrap else { return }
        didBootstrap = true
        await importShopifyAndSync()
    }

    func importShopifyAndSync() async {
        guard let client = apiClient else {
            syncError = "URL de API no valida"
            isAPIConnected = false
            return
        }
        isLoading = true
        syncError = nil
        defer { isLoading = false }

        do {
            try await client.importShopifyOrders()
            try await loadSnapshot(from: client)
        } catch {
            isAPIConnected = false
            syncError = "No se pudo sincronizar Shopify/API: \(error.localizedDescription)"
        }
    }

    func syncFromAPI() async {
        guard !isLoading else { return }
        guard let client = apiClient else {
            syncError = "URL de API no valida"
            isAPIConnected = false
            return
        }
        isLoading = true
        syncError = nil
        defer { isLoading = false }

        do {
            try await loadSnapshot(from: client)
        } catch {
            isAPIConnected = false
            syncError = "Sin conexion real con la API: \(error.localizedDescription)"
        }
    }

    func syncQuietlyIfIdle() async {
        guard labelCreationOrderID == nil, labelScanOrderID == nil, !isLoading else { return }
        await syncFromAPI()
    }

    func loadMappingWorkbench() async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            mappingWorkbench = try await client.mappingWorkbench()
        } catch {
            syncError = "No se pudieron cargar los mapeos: \(error.localizedDescription)"
        }
    }

    func saveMapping(for product: UnmappedProduct, subproductName: String) async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            _ = try await client.saveProductMapping(ProductMappingSaveRequest(
                productName: product.productName,
                productType: product.productType,
                color: product.color,
                size: product.size ?? product.variantTitle,
                sku: product.sku.isEmpty ? nil : product.sku,
                subproductName: subproductName,
                imageRef: nil
            ))
            mappingWorkbench = try await client.mappingWorkbench()
            try await loadSnapshot(from: client)
        } catch {
            syncError = "No se pudo guardar el mapeo: \(error.localizedDescription)"
        }
    }

    func loadPickingList(for order: WorkshopOrder) async {
        guard let client = apiClient else { return }
        do {
            let list = try await client.orderPickingList(orderId: order.remoteID ?? order.number)
            orderPickingLists[order.remoteID ?? order.number] = list
        } catch {
            syncError = "No se pudo cargar que coger: \(error.localizedDescription)"
        }
    }

    func markRecommendedPurchasesOrdered() async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            _ = try await client.markRecommendedPurchasesOrdered()
            try await loadSnapshot(from: client)
        } catch {
            syncError = "No se pudo marcar compra pendiente: \(error.localizedDescription)"
        }
    }

    func receiveAllOrderedPurchases() async {
        guard let client = apiClient else { return }
        let lines = purchaseMatrix.flatMap { group in
            group.entries.compactMap { entry -> ReceivePurchaseLineRequest? in
                guard let stockItemId = entry.stockItemId, entry.alreadyOrderedQuantity > 0 else { return nil }
                return ReceivePurchaseLineRequest(stockItemId: stockItemId, quantity: entry.alreadyOrderedQuantity)
            }
        }
        guard !lines.isEmpty else { return }
        syncError = nil
        do {
            _ = try await client.receivePurchase(lines: lines)
            try await loadSnapshot(from: client)
        } catch {
            syncError = "No se pudo recibir compra: \(error.localizedDescription)"
        }
    }

    private func loadSnapshot(from client: APIClient) async throws {
        let snapshot = try await client.fetchSnapshot()
        orders = snapshot.orders
        tasks = snapshot.tasks
        stock = snapshot.stock
        purchaseNeeds = snapshot.purchaseNeeds
        purchaseMatrix = snapshot.purchaseMatrix
        isAPIConnected = true
        lastSyncText = Date().formatted(.dateTime.hour().minute().second())
    }

    func start(_ task: WorkshopTask) {
        updateTask(task) { $0.status = .inProgress }
    }

    func complete(_ task: WorkshopTask) {
        updateTask(task) { $0.status = .done }
    }

    func block(_ task: WorkshopTask, reason: String) {
        updateTask(task) {
            $0.status = .blocked
            $0.priority = .blocked
            $0.blockedReason = reason
        }
    }

    func markPrepared(_ order: WorkshopOrder) {
        guard let index = orders.firstIndex(where: { $0.id == order.id }) else { return }
        orders[index].status = .readyForLabel
    }

    func reopenPreparation(_ order: WorkshopOrder) {
        guard let index = orders.firstIndex(where: { $0.id == order.id }) else { return }
        orders[index].status = .waitingPicking
    }

    func startRemote(_ task: WorkshopTask) async {
        start(task)
        guard let remoteID = task.remoteID, let client = apiClient else { return }
        do {
            try await client.startTask(id: remoteID)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo iniciar en API: \(error.localizedDescription)"
        }
    }

    func completeRemote(_ task: WorkshopTask) async {
        complete(task)
        guard let remoteID = task.remoteID, let client = apiClient else { return }
        do {
            try await client.completeTask(id: remoteID)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo completar en API: \(error.localizedDescription)"
        }
    }

    func blockRemote(_ task: WorkshopTask, reason: String) async {
        block(task, reason: reason)
        guard let remoteID = task.remoteID, let client = apiClient else { return }
        do {
            try await client.blockTask(id: remoteID, reason: reason)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo bloquear en API: \(error.localizedDescription)"
        }
    }

    func createLabelRemote(for order: WorkshopOrder) async {
        guard let client = apiClient else { return }
        labelCreationOrderID = order.id
        syncError = nil
        defer { labelCreationOrderID = nil }

        do {
            let shipment = try await client.createLabel(orderId: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index].tracking = nil
                orders[index].status = .labelCreated
                orders[index].printStatus = shipment.labelUrl == nil ? .none : .pending
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo crear etiqueta en API: \(error.localizedDescription)"
        }
    }

    func scanLabelRemote(for order: WorkshopOrder, barcode: String, photo: Data? = nil) async {
        guard let client = apiClient else { return }
        labelScanOrderID = order.id
        syncError = nil
        defer { labelScanOrderID = nil }

        do {
            let shipment = try await client.scanLabel(orderId: order.remoteID ?? order.number, barcode: barcode, photo: photo)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index].tracking = shipment.trackingNumber ?? barcode
                orders[index].status = .shipped
                if orders[index].printStatus == .none {
                    orders[index].printStatus = shipment.labelUrl == nil ? .none : .pending
                }
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo confirmar la etiqueta escaneada: \(error.localizedDescription)"
        }
    }

    func finalizeWithoutLabelRemote(for order: WorkshopOrder) async {
        guard let client = apiClient else { return }
        labelCreationOrderID = order.id
        syncError = nil
        defer { labelCreationOrderID = nil }

        do {
            _ = try await client.finalizeWithoutLabel(orderId: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index].status = .shipped
                orders[index].tracking = nil
                orders[index].printStatus = .none
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo finalizar sin etiqueta: \(error.localizedDescription)"
            await syncFromAPI()
        }
    }

    func finalizeCreatedLabelRemote(for order: WorkshopOrder) async {
        guard let client = apiClient else { return }
        labelCreationOrderID = order.id
        syncError = nil
        defer { labelCreationOrderID = nil }

        do {
            let shipment = try await client.finalizeCreatedLabel(orderId: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index].status = .shipped
                orders[index].tracking = shipment.trackingNumber ?? orders[index].tracking
                orders[index].printStatus = .printed
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo finalizar etiqueta creada: \(error.localizedDescription)"
            await syncFromAPI()
        }
    }

    func setStockQuantity(sku: String, quantity: Int) async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            try await client.setStockQuantity(sku: sku, quantity: quantity)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo actualizar stock: \(error.localizedDescription)"
            await syncFromAPI()
        }
    }

    func markPreparedRemote(_ order: WorkshopOrder, photo: Data? = nil) async {
        markPrepared(order)
        guard let client = apiClient else { return }
        do {
            let updated = try await client.markOrderPrepared(id: order.remoteID ?? order.number, photo: photo)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = updated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo marcar preparado en API: \(error.localizedDescription)"
            await syncFromAPI()
        }
    }

    func reprintLabelRemote(for order: WorkshopOrder) async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            try await client.reprintLabelByOrder(orderId: order.remoteID ?? order.number)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo reimprimir: \(error.localizedDescription)"
        }
    }

    func reprintLabelByShipment(_ shipmentId: String) async {
        guard let client = apiClient else { return }
        syncError = nil
        do {
            try await client.reprintLabel(shipmentId: shipmentId)
            await syncFromAPI()
        } catch {
            syncError = "No se pudo reimprimir: \(error.localizedDescription)"
        }
    }

    func reopenPreparationRemote(_ order: WorkshopOrder) async {
        reopenPreparation(order)
        guard let client = apiClient else { return }
        do {
            let updated = try await client.reopenOrderPreparation(id: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = updated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo devolver el pedido a sin preparar: \(error.localizedDescription)"
        }
    }

    private func updateTask(_ task: WorkshopTask, mutate: (inout WorkshopTask) -> Void) {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        mutate(&tasks[index])
    }
}

struct ContentView: View {
    @State private var store = WorkshopStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        MainTabView()
            .environment(store)
            .preferredColorScheme(.dark)
            .tint(AppTheme.blue)
            .task {
                await store.bootstrap()
            }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(25))
                    if scenePhase != .active { break }
                    await store.syncQuietlyIfIdle()
                }
            }
            .onChange(of: scenePhase) { _, new in
                if new == .active {
                    Task { await store.syncQuietlyIfIdle() }
                }
            }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Inicio", systemImage: "house.fill") }
            PickingView()
                .tabItem { Label("Sin preparar", systemImage: "shippingbox.fill") }
            ShippingView()
                .tabItem { Label("Envios", systemImage: "truck.box.fill") }
            StockView()
                .tabItem { Label("Stock", systemImage: "barcode.viewfinder") }
            PurchaseMatrixView()
                .tabItem { Label("Compras", systemImage: "cart.badge.plus") }
            FinalizedView()
                .tabItem { Label("Finalizados", systemImage: "checkmark.seal.fill") }
            ManualPrintView()
                .tabItem { Label("Imprimir", systemImage: "printer.fill") }
            EconomicsView()
                .tabItem { Label("Economía", systemImage: "eurosign.circle.fill") }
            AdminView()
                .tabItem { Label("Admin", systemImage: "chart.bar.xaxis") }
        }
        .tint(AppTheme.blue)
    }
}

struct ManualPrintView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var showingPicker = false
    @State private var status: ManualPrintStatus = .idle
    @State private var lastFilename: String?

    enum ManualPrintStatus: Equatable {
        case idle
        case uploading(String)
        case success(String)
        case failure(String)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Imprimir etiqueta")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Selecciona un PDF y se enviará a la PC42d del taller.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Label("Cómo funciona", systemImage: "info.circle.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AppTheme.blue)
                        VStack(alignment: .leading, spacing: 6) {
                            ManualPrintStep(number: "1", text: "Toca «Seleccionar PDF» y elige la etiqueta.")
                            ManualPrintStep(number: "2", text: "Se sube a la API y queda en cola.")
                            ManualPrintStep(number: "3", text: "El agente del taller la imprime en pocos segundos.")
                        }
                    }
                    .glassPanel(padding: 16, accent: AppTheme.blue)

                    Button {
                        showingPicker = true
                    } label: {
                        Label("Seleccionar PDF", systemImage: "doc.fill.badge.plus")
                            .frame(maxWidth: .infinity)
                            .font(.headline.weight(.bold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.blue)
                    .controlSize(.large)
                    .disabled(isUploading)

                    statusView
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Imprimir")
            .fileImporter(
                isPresented: $showingPicker,
                allowedContentTypes: [.pdf],
                allowsMultipleSelection: false
            ) { result in
                handlePicker(result: result)
            }
        }
    }

    private var isUploading: Bool {
        if case .uploading = status { return true }
        return false
    }

    @ViewBuilder
    private var statusView: some View {
        switch status {
        case .idle:
            EmptyView()
        case .uploading(let name):
            HStack(spacing: 12) {
                ProgressView()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Enviando…").font(.subheadline.weight(.bold)).foregroundStyle(AppTheme.ink)
                    Text(name).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                }
                Spacer()
            }
            .glassPanel(padding: 14, accent: AppTheme.amber)
        case .success(let msg):
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(AppTheme.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text("En cola para imprimir").font(.subheadline.weight(.bold)).foregroundStyle(AppTheme.ink)
                    Text(msg).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(2)
                }
                Spacer()
            }
            .glassPanel(padding: 14, accent: AppTheme.green)
        case .failure(let msg):
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.title2)
                    .foregroundStyle(AppTheme.red)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Error al subir").font(.subheadline.weight(.bold)).foregroundStyle(AppTheme.ink)
                    Text(msg).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(4)
                }
                Spacer()
            }
            .glassPanel(padding: 14, accent: AppTheme.red)
        }
    }

    private func handlePicker(result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            status = .failure(error.localizedDescription)
        case .success(let urls):
            guard let url = urls.first else { return }
            Task { await uploadPDF(url: url) }
        }
    }

    private func uploadPDF(url: URL) async {
        let needsScope = url.startAccessingSecurityScopedResource()
        defer { if needsScope { url.stopAccessingSecurityScopedResource() } }

        let filename = url.lastPathComponent
        lastFilename = filename
        status = .uploading(filename)

        guard let client = store.apiClient else {
            status = .failure("URL de API no válida en Admin.")
            return
        }

        do {
            let data = try Data(contentsOf: url)
            guard !data.isEmpty else {
                status = .failure("El archivo está vacío.")
                return
            }
            let response = try await client.uploadManualLabel(filename: filename, pdfData: data)
            status = .success("\(response.filename) (\(formatBytes(data.count)))")
        } catch {
            status = .failure(error.localizedDescription)
        }
    }

    private func formatBytes(_ count: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(count), countStyle: .file)
    }
}

struct ManualPrintStep: View {
    let number: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(.caption.weight(.heavy))
                .foregroundStyle(AppTheme.blue)
                .frame(width: 22, height: 22)
                .background(AppTheme.blueSoft)
                .clipShape(Circle())
            Text(text)
                .font(.subheadline)
                .foregroundStyle(AppTheme.inkSoft)
        }
    }
}

struct DashboardView: View {
    @Environment(WorkshopStore.self) private var store

    var pendingToday: [WorkshopOrder] {
        OrderSort.smart.sort(store.pendingPreparationOrders)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()
                    TodayHeader(remaining: pendingToday.count, critical: store.urgentPendingOrders)

                    if pendingToday.isEmpty {
                        TodayEmptyState()
                    } else {
                        SectionHeader(title: "A preparar hoy", subtitle: "Tap en cada uno para verlo. Empieza por el de arriba.")
                        LazyVStack(spacing: 10) {
                            ForEach(pendingToday) { order in
                                NavigationLink(value: order) {
                                    TodayOrderCard(order: order)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Hoy")
            .toolbar {
                Button {
                    Task { await store.syncFromAPI() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.isLoading)
            }
            .refreshable {
                await store.syncFromAPI()
            }
            .navigationDestination(for: WorkshopTask.self) { task in
                TaskDetailView(task: task)
            }
            .navigationDestination(for: WorkshopOrder.self) { order in
                OrderPreparationDetailView(order: order)
            }
        }
    }
}

struct TodayHeader: View {
    let remaining: Int
    let critical: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Plan del día")
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Text(Date().formatted(.dateTime.weekday(.wide).day().month(.abbreviated)))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
            }
            HStack(spacing: 8) {
                TodayPill(value: "\(remaining)", label: "Por preparar", color: AppTheme.blue, soft: AppTheme.blueSoft, icon: "shippingbox.fill")
                TodayPill(value: "\(critical)", label: "Críticos", color: AppTheme.red, soft: AppTheme.redSoft, icon: "flame.fill")
            }
        }
        .glassPanel(padding: 18)
    }
}

struct TodayPill: View {
    let value: String
    let label: String
    let color: Color
    let soft: Color
    let icon: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 30, height: 30)
                .background(soft)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text(value)
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(AppTheme.ink)
                Text(label.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.4)
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surfaceSoft)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.lineSoft))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct TodayEmptyState: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 60))
                .foregroundStyle(AppTheme.green)
            Text("Día terminado")
                .font(.title2.weight(.heavy))
                .foregroundStyle(AppTheme.ink)
            Text("No quedan pedidos por preparar. Buen trabajo.")
                .font(.subheadline)
                .foregroundStyle(AppTheme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .glassPanel(padding: 24, accent: AppTheme.green)
    }
}

struct TodayOrderCard: View {
    let order: WorkshopOrder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: order.shippingCategory == .premium ? "bolt.fill" : order.shippingCategory == .free ? "gift.fill" : "shippingbox.fill")
                .font(.title3.weight(.bold))
                .foregroundStyle(order.priority.color)
                .frame(width: 42, height: 42)
                .background(order.priority.softColor)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(order.number)
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Spacer()
                    PriorityBadge(priority: order.priority)
                }
                Text(order.customer)
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Label("\(order.totalUnits) ud", systemImage: "number")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                    Text("·").foregroundStyle(AppTheme.muted)
                    Text(order.shippingCategory.rawValue)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
        }
        .glassPanel(padding: 12, accent: order.priority.color)
    }
}

struct ProductionQueueView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var filter: ProductionFilter = .all

    var visibleTasks: [WorkshopTask] {
        store.priorityQueue
            .filter { $0.priority != .blocked }
            .filter { filter.matches($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Fabricar")
                            .font(.system(size: 36, weight: .black))
                        HStack(spacing: 8) {
                            Tag(text: "\(visibleTasks.count) tareas", systemImage: "hammer.fill")
                            Tag(text: "\(store.criticalTasks) críticas", systemImage: "flame.fill")
                        }
                    }

                    Picker("Filtro", selection: $filter) {
                        ForEach(ProductionFilter.allCases) { item in
                            Text(item.rawValue).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)

                    if visibleTasks.isEmpty {
                        ContentUnavailableView("Nada pendiente", systemImage: "checkmark.circle.fill", description: Text("La cola de fabricación está limpia."))
                            .glassPanel()
                    } else {
                        ForEach(visibleTasks) { task in
                            NavigationLink(value: task) {
                                TaskCard(task: task, showsActions: false)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Fabricar")
            .toolbar {
                Button {
                    Task { await store.syncFromAPI() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.isLoading)
            }
            .refreshable {
                await store.syncFromAPI()
            }
            .navigationDestination(for: WorkshopTask.self) { task in
                TaskDetailView(task: task)
            }
        }
    }
}

struct DashboardHeroView: View {
    @Environment(WorkshopStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [AppTheme.blue, AppTheme.teal],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Image(systemName: "shippingbox.and.arrow.backward.fill")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                }
                .frame(width: 52, height: 52)
                .shadow(color: AppTheme.blue.opacity(0.25), radius: 10, x: 0, y: 4)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Taller en marcha")
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundStyle(AppTheme.ink)
                    Text("Sincronizado con Shopify y Sendcloud.")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
            }

            HStack(spacing: 10) {
                HeroPill(title: "Pendientes", value: "\(store.pendingPreparationOrders.count)", color: AppTheme.blue, soft: AppTheme.blueSoft, icon: "tray.full.fill")
                HeroPill(title: "Listos envío", value: "\(store.readyForShipping)", color: AppTheme.green, soft: AppTheme.greenSoft, icon: "paperplane.fill")
            }
        }
        .glassPanel(padding: 18)
    }
}

struct HeroPill: View {
    let title: String
    let value: String
    let color: Color
    let soft: Color
    let icon: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 32, height: 32)
                .background(soft)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(value)
                    .font(.system(size: 20, weight: .heavy, design: .rounded))
                    .foregroundStyle(AppTheme.ink)
                Text(title.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.5)
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.surfaceSoft)
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(AppTheme.lineSoft, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct TaskDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let task: WorkshopTask
    @State private var incidentReason = "Falta stock"

    var currentTask: WorkshopTask {
        store.tasks.first(where: { $0.id == task.id }) ?? task
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TaskCard(task: currentTask, showsActions: false)
                InfoPanel(title: "Pedido relacionado", rows: [
                    currentTask.orderNumber,
                    "SKU: \(currentTask.sku)",
                    "Deadline: \(currentTask.deadline)"
                ])
                InfoPanel(title: "Componentes", rows: components(for: currentTask))
                VStack(spacing: 10) {
                    Button { Task { await store.startRemote(currentTask) } } label: {
                        Label("Empezar", systemImage: "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Button { Task { await store.completeRemote(currentTask) } } label: {
                        Label("Fabricado", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)

                    TextField("Motivo incidencia", text: $incidentReason)
                        .textFieldStyle(.roundedBorder)

                    Button(role: .destructive) { Task { await store.blockRemote(currentTask, reason: incidentReason) } } label: {
                        Label("Falta stock / incidencia", systemImage: "exclamationmark.triangle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle(currentTask.orderNumber)
    }

    private func components(for task: WorkshopTask) -> [String] {
        if task.productName.localizedCaseInsensitiveContains("pegatina") {
            return ["Pegatina Magic Alonso - PACKING", "Sobre - PACKING", "Etiqueta - PACKING"]
        }
        if task.productName.localizedCaseInsensitiveContains("sudadera") {
            return ["Sudadera negra \(task.size) - EST-A-01", "Transfer Fernando - TALLER", "Bolsa - PACKING"]
        }
        if task.productName.localizedCaseInsensitiveContains("nano") {
            return ["Camiseta lisa blanca \(task.size) - EST-A-02", "Transfer Nano - TALLER", "Bolsa - PACKING"]
        }
        return ["Camiseta lisa \(task.color.lowercased()) \(task.size) - EST-A-01", "Transfer Fernando - TALLER", "Bolsa - PACKING"]
    }
}

struct PickingView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var shippingFilter: ShippingChoice = .all
    @State private var priorityFilter: PriorityChoice = .all
    @State private var sort: OrderSort = .smart
    @State private var searchText = ""
    @State private var rafagaActive = false

    var filteredOrders: [WorkshopOrder] {
        let filtered = store.pendingPreparationOrders
            .filter { shippingFilter.matches($0) }
            .filter { priorityFilter.matches($0) }
            .filter { matchesSearch($0) }
        return sort.sort(filtered)
    }

    var hasActiveFilters: Bool {
        shippingFilter != .all || priorityFilter != .all || sort != .smart
    }

    private func matchesSearch(_ order: WorkshopOrder) -> Bool {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        return order.number.localizedCaseInsensitiveContains(query) ||
            order.customer.localizedCaseInsensitiveContains(query) ||
            order.shippingMethod.localizedCaseInsensitiveContains(query) ||
            order.items.contains {
                $0.title.localizedCaseInsensitiveContains(query) ||
                $0.sku.localizedCaseInsensitiveContains(query) ||
                ($0.variantTitle?.localizedCaseInsensitiveContains(query) ?? false)
            }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sin preparar")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(AppTheme.ink)
                        Text("Shopify y hoja, ordenados por urgencia.")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        MetricTile(title: "Críticos", value: store.urgentPendingOrders, color: AppTheme.magenta, icon: "flame.fill")
                        MetricTile(title: "Altos", value: store.highPendingOrders, color: AppTheme.amber, icon: "arrow.up.circle.fill")
                        MetricTile(title: "Bloqueados", value: store.blockedOrders, color: .red, icon: "exclamationmark.triangle.fill")
                        MetricTile(title: "Total", value: filteredOrders.count, color: AppTheme.purple, icon: "shippingbox.fill")
                    }

                    HStack(spacing: 10) {
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass")
                                .foregroundStyle(AppTheme.muted)
                            TextField("Buscar pedido, SKU, cliente…", text: $searchText)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.default)
                            if !searchText.isEmpty {
                                Button { searchText = "" } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(AppTheme.muted)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 11)
                        .background(AppTheme.surfaceSoft)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                        Menu {
                            Section("Tipo de envío") {
                                Picker("Envío", selection: $shippingFilter) {
                                    ForEach(ShippingChoice.allCases) { option in
                                        Label(option.rawValue, systemImage: option.iconName).tag(option)
                                    }
                                }
                            }
                            Section("Prioridad") {
                                Picker("Prioridad", selection: $priorityFilter) {
                                    ForEach(PriorityChoice.allCases) { option in
                                        Label(option.rawValue, systemImage: option.iconName).tag(option)
                                    }
                                }
                            }
                            Section("Ordenar") {
                                Picker("Ordenar", selection: $sort) {
                                    ForEach(OrderSort.allCases) { option in
                                        Label(option.rawValue, systemImage: option.iconName).tag(option)
                                    }
                                }
                            }
                            if hasActiveFilters {
                                Divider()
                                Button(role: .destructive) {
                                    shippingFilter = .all
                                    priorityFilter = .all
                                    sort = .smart
                                } label: {
                                    Label("Limpiar filtros", systemImage: "xmark.circle")
                                }
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "line.3.horizontal.decrease.circle.fill")
                                    .font(.subheadline.weight(.bold))
                                Image(systemName: "chevron.down")
                                    .font(.caption2.weight(.bold))
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .background(hasActiveFilters ? AppTheme.blue : AppTheme.surfaceSoft)
                            .foregroundStyle(hasActiveFilters ? .white : AppTheme.inkSoft)
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(hasActiveFilters ? Color.clear : AppTheme.line))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    if hasActiveFilters {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                if shippingFilter != .all {
                                    ActiveFilterChip(text: shippingFilter.rawValue, icon: shippingFilter.iconName) {
                                        shippingFilter = .all
                                    }
                                }
                                if priorityFilter != .all {
                                    ActiveFilterChip(text: priorityFilter.rawValue, icon: priorityFilter.iconName) {
                                        priorityFilter = .all
                                    }
                                }
                                if sort != .smart {
                                    ActiveFilterChip(text: sort.shortLabel, icon: sort.iconName) {
                                        sort = .smart
                                    }
                                }
                            }
                        }
                    }

                    if filteredOrders.isEmpty {
                        ContentUnavailableView("Nada pendiente", systemImage: "checkmark.circle.fill", description: Text("No hay pedidos con estos filtros."))
                            .glassPanel()
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredOrders) { order in
                                NavigationLink(value: order) {
                                    PendingOrderRow(order: order, showsAction: false) {}
                                        .glassPanel(padding: 14, accent: order.priority.color)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Sin preparar")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { rafagaActive = true } label: {
                        Image(systemName: "barcode.viewfinder")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.syncFromAPI() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(store.isLoading)
                }
            }
            .refreshable {
                await store.syncFromAPI()
            }
            .navigationDestination(for: WorkshopOrder.self) { order in
                OrderPreparationDetailView(order: order)
            }
            .fullScreenCover(isPresented: $rafagaActive) {
                RafagaPickingView(orders: store.pendingPreparationOrders)
            }
        }
    }
}

struct RafagaPickingView: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let orders: [WorkshopOrder]
    @State private var preparedIDs: Set<UUID> = []
    @State private var lastScan: String?
    @State private var lastMatch: WorkshopOrder?
    @State private var lastError: String?
    @State private var locked = false

    var pending: [WorkshopOrder] {
        OrderSort.smart.sort(orders.filter { !preparedIDs.contains($0.id) })
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                BarcodeScannerKey(active: !locked) { code in
                    handleScan(code)
                }
                .ignoresSafeArea()

                VStack(spacing: 12) {
                    if let match = lastMatch {
                        RafagaMatchCard(order: match)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    } else if let err = lastError {
                        RafagaErrorCard(message: err, scanned: lastScan ?? "")
                    } else {
                        VStack(spacing: 4) {
                            Text("Modo ráfaga")
                                .font(.headline.weight(.heavy))
                                .foregroundStyle(.white)
                            Text("Escanea SKUs o números de pedido. Cada acierto marca preparado.")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.8))
                                .multilineTextAlignment(.center)
                        }
                        .padding(.horizontal)
                    }
                    VStack(spacing: 6) {
                        Text("\(pending.count) por preparar")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                        if pending.isEmpty {
                            Text("✓ Cola limpia")
                                .font(.title3.weight(.heavy))
                                .foregroundStyle(.white)
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color.black.opacity(0.55))
                .padding(.bottom, 40)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Salir") { dismiss() }
                        .foregroundStyle(.white)
                }
            }
            .toolbarBackground(.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .preferredColorScheme(.dark)
    }

    private func handleScan(_ code: String) {
        guard !locked else { return }
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if trimmed == lastScan { return }
        lastScan = trimmed
        let lowered = trimmed.lowercased()
        if let match = pending.first(where: { order in
            order.number.lowercased() == lowered
                || order.number.lowercased() == "#" + lowered
                || ("#" + order.number.lowercased()) == lowered
                || order.items.contains { $0.sku.lowercased() == lowered }
        }) {
            locked = true
            lastMatch = match
            lastError = nil
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            preparedIDs.insert(match.id)
            Task {
                await store.markPreparedRemote(match)
                try? await Task.sleep(for: .milliseconds(900))
                lastMatch = nil
                locked = false
            }
        } else {
            lastError = "Sin coincidencia"
            lastMatch = nil
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            Task {
                try? await Task.sleep(for: .seconds(1))
                if lastScan == trimmed { lastError = nil; lastScan = nil }
            }
        }
    }
}

struct BarcodeScannerKey: View {
    let active: Bool
    var onCode: (String) -> Void

    var body: some View {
        BarcodeScannerView(capturesPhoto: false, continuous: true) { code, _ in
            if active { onCode(code) }
        }
    }
}

struct RafagaMatchCard: View {
    let order: WorkshopOrder

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title)
                .foregroundStyle(AppTheme.green)
            VStack(alignment: .leading) {
                Text(order.number)
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(.white)
                Text(order.customer)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
            }
            Spacer()
        }
        .padding()
        .background(AppTheme.green.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
    }
}

struct RafagaErrorCard: View {
    let message: String
    let scanned: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.title)
                .foregroundStyle(AppTheme.red)
            VStack(alignment: .leading) {
                Text(message)
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(.white)
                Text(scanned)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
            }
            Spacer()
        }
        .padding()
        .background(AppTheme.red.opacity(0.35))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
    }
}

struct ShippingView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var scanningOrder: WorkshopOrder?
    @State private var searchText = ""
    @State private var queueSort: ShippingQueueSort = .preparedOldest

    var allShippingCandidates: [WorkshopOrder] {
        queueSort.sort(store.orders.filter { $0.status == .readyForLabel || $0.status == .labelCreated })
    }

    // En envíos deben seguir apareciendo los pedidos con etiqueta creada aunque Sendcloud ya devuelva tracking.
    // Solo salen de aquí cuando se escanea la etiqueta o se finalizan sin etiqueta.
    var pendingShipping: [WorkshopOrder] {
        allShippingCandidates
    }

    var filteredOrders: [WorkshopOrder] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return pendingShipping }
        return pendingShipping.filter { matchesSearch($0, query: query) }
    }

    private func matchesSearch(_ order: WorkshopOrder, query: String) -> Bool {
        order.number.localizedCaseInsensitiveContains(query) ||
        order.customer.localizedCaseInsensitiveContains(query) ||
        order.shippingMethod.localizedCaseInsensitiveContains(query) ||
        (order.tracking ?? "").localizedCaseInsensitiveContains(query) ||
        order.items.contains {
            $0.sku.localizedCaseInsensitiveContains(query) ||
            $0.title.localizedCaseInsensitiveContains(query) ||
            ($0.variantTitle ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Envios")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(AppTheme.ink)
                        Text("Pedidos preparados, etiquetas y lectura de tracking.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Pendientes", value: pendingShipping.count, color: AppTheme.blue, icon: "shippingbox.fill")
                        MetricTile(title: "Sin etiqueta", value: pendingShipping.filter { $0.status == .readyForLabel && $0.printStatus == .none }.count, color: AppTheme.amber, icon: "tag")
                        MetricTile(title: "Imprimir", value: pendingShipping.filter { $0.printStatus == .pending }.count, color: AppTheme.magenta, icon: "printer.fill")
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(AppTheme.muted)
                        TextField("Buscar pedido, cliente, tracking o SKU", text: $searchText)
                            .textInputAutocapitalization(.never)
                        if !searchText.isEmpty {
                            Button { searchText = "" } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(AppTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(AppTheme.surfaceSoft)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    Picker("Orden", selection: $queueSort) {
                        ForEach(ShippingQueueSort.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)

                    if filteredOrders.isEmpty {
                        ContentUnavailableView(
                            pendingShipping.isEmpty ? "Sin envíos pendientes" : "Sin resultados",
                            systemImage: pendingShipping.isEmpty ? "checkmark.seal" : "magnifyingglass",
                            description: Text(pendingShipping.isEmpty
                                ? "Cuando marques un pedido como preparado aparecerá aquí. Los escaneados pasan a Finalizados."
                                : "Ningún pedido coincide con «\(searchText)»."
                            )
                        )
                        .glassPanel(accent: AppTheme.green)
                    } else {
                        LazyVStack(spacing: 14) {
                            ForEach(filteredOrders) { order in
                                ShippingOrderCard(order: order, scanningOrder: $scanningOrder)
                            }
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Envios")
            .toolbar {
                Button {
                    Task { await store.syncFromAPI() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.isLoading)
            }
            .refreshable {
                await store.syncFromAPI()
            }
            .navigationDestination(for: WorkshopOrder.self) { order in
                OrderPreparationDetailView(order: order)
            }
            .sheet(item: $scanningOrder) { order in
                NavigationStack {
                    LabelScanView(order: order) { barcode, photo in
                        scanningOrder = nil
                        Task { await store.scanLabelRemote(for: order, barcode: barcode, photo: photo) }
                    }
                    .navigationTitle(order.number)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        Button("Cerrar") { scanningOrder = nil }
                    }
                }
            }
        }
    }
}

struct ShippingOrderCard: View {
    @Environment(WorkshopStore.self) private var store
    let order: WorkshopOrder
    @Binding var scanningOrder: WorkshopOrder?

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.number)
                        .font(.title2.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    Text(order.customer)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                PriorityBadge(priority: order.priority)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8)], alignment: .leading, spacing: 8) {
                SourceChip(source: order.source)
                StatusChip(status: order.status)
                ShippingChip(category: order.shippingCategory)
                PrintStatusChip(status: order.printStatus)
                Tag(text: order.hasMultipleItems ? "\(order.items.count) articulos" : "1 articulo", systemImage: "square.stack.3d.up.fill")
            }

            HStack(spacing: 12) {
                Text(order.shippingMethod)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                if let prepared = order.preparedAtShort {
                    Spacer(minLength: 0)
                    Label("Preparado \(prepared)", systemImage: "checkmark.circle")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.green)
                        .lineLimit(1)
                } else if let created = order.createdAtShort {
                    Spacer(minLength: 0)
                    Label(created, systemImage: "calendar")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }

            VStack(alignment: .leading, spacing: 7) {
                ForEach(order.items.prefix(4)) { item in
                    CompactOrderItemLine(item: item)
                }
                if order.items.count > 4 {
                    Text("+\(order.items.count - 4) articulos mas")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.amber)
                }
            }
            .padding(12)
            .background(AppTheme.surfaceSoft)
            .clipShape(RoundedRectangle(cornerRadius: 14))

            if let tracking = order.tracking, order.status == .labelCreated {
                Label("Tracking generado: \(tracking). Falta escanear la etiqueta.", systemImage: "barcode.viewfinder")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            } else if let tracking = order.tracking {
                Label(tracking, systemImage: "barcode.viewfinder")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.teal)
            } else if order.printStatus == .pending {
                Label("Etiqueta creada, pendiente de imprimir en taller", systemImage: "printer.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            } else if order.printStatus == .printed {
                Label("Etiqueta impresa", systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.green)
            }

            VStack(spacing: 9) {
                if order.status == .readyForLabel && order.printStatus == .none {
                    Button { Task { await store.createLabelRemote(for: order) } } label: {
                        if store.labelCreationOrderID == order.id {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Label("Crear etiqueta", systemImage: "tag.fill").frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.blue)
                    .disabled(store.labelCreationOrderID != nil)
                }

                Button { scanningOrder = order } label: {
                    if store.labelScanOrderID == order.id {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Label("Escanear codigo de etiqueta", systemImage: "barcode.viewfinder")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.teal)
                .disabled(store.labelScanOrderID != nil)

                if order.status == .readyForLabel && order.printStatus == .none {
                    Button {
                        Task { await store.finalizeWithoutLabelRemote(for: order) }
                    } label: {
                        if store.labelCreationOrderID == order.id {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Label("Finalizar sin etiqueta", systemImage: "checkmark.seal.fill")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.green)
                    .disabled(store.labelCreationOrderID != nil)
                }

                if order.status == .labelCreated || order.printStatus != .none {
                    Button {
                        Task { await store.finalizeCreatedLabelRemote(for: order) }
                    } label: {
                        if store.labelCreationOrderID == order.id {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Label("Finalizar sin escanear", systemImage: "checkmark.seal.fill")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.green)
                    .disabled(store.labelCreationOrderID != nil)
                }

                if order.tracking != nil || order.printStatus != .none {
                    Button {
                        Task { await store.reprintLabelRemote(for: order) }
                    } label: {
                        Label("Reimprimir etiqueta", systemImage: "printer.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.amber)
                }

                HStack(spacing: 10) {
                    Button { Task { await store.reopenPreparationRemote(order) } } label: {
                        Label("Sin preparar", systemImage: "arrow.uturn.backward.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(order.status == .shipped)

                    NavigationLink(value: order) {
                        Label("Ver pedido", systemImage: "doc.text.magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .glassPanel(padding: 14, accent: order.priority.color)
    }
}

struct LabelScanView: View {
    let order: WorkshopOrder
    var onBarcode: (String, Data?) -> Void
    @State private var manualBarcode = ""

    var body: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Escanea la etiqueta del paquete")
                    .font(.headline.weight(.black))
                Text("Al leer el código se guardará el tracking y una foto del paquete escaneado.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()

            BarcodeScannerView(capturesPhoto: true) { code, photo in
                onBarcode(code, photo)
            }
            .frame(maxWidth: .infinity, minHeight: 340)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal)

            VStack(spacing: 10) {
                TextField("Número de barras / tracking", text: $manualBarcode)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                Button {
                    onBarcode(manualBarcode, nil)
                } label: {
                    Label("Confirmar sin foto", systemImage: "checkmark.seal.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.teal)
                .disabled(manualBarcode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding()

            Spacer()
        }
        .screenBackground()
    }
}

struct StockView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var query = ""
    @State private var showingScanner = false
    @State private var stockEdit: StockEditSelection?

    var filteredGroups: [PurchaseMatrixGroup] {
        guard !query.isEmpty else { return store.purchaseMatrix }
        return store.purchaseMatrix.filter { group in
            group.title.localizedCaseInsensitiveContains(query) ||
            group.color.localizedCaseInsensitiveContains(query) ||
            group.garmentType.localizedCaseInsensitiveContains(query) ||
            group.entries.contains {
                $0.size.localizedCaseInsensitiveContains(query) ||
                $0.subproductName.localizedCaseInsensitiveContains(query)
            }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Stock")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(AppTheme.ink)
                        Text("Stock real del taller. Toca una talla para modificar unidades.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalStock }, color: AppTheme.green, icon: "archivebox.fill")
                        MetricTile(title: "Con stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock > 0 }.count }, color: AppTheme.blue, icon: "checkmark.circle.fill")
                        MetricTile(title: "Sin stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock == 0 }.count }, color: AppTheme.amber, icon: "exclamationmark.circle.fill")
                    }

                    VStack(spacing: 10) {
                        TextField("Buscar camiseta, sudadera, color o talla", text: $query)
                            .textFieldStyle(.roundedBorder)
                        Button { showingScanner = true } label: {
                            Label("Escanear QR / codigo de barras", systemImage: "barcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.blue)
                    }
                    .glassPanel(padding: 12)

                    if filteredGroups.isEmpty {
                        ContentUnavailableView("Sin resultados", systemImage: "square.grid.3x3", description: Text("No hay colores o tallas que coincidan con la busqueda."))
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 16)], spacing: 16) {
                            ForEach(filteredGroups) { group in
                                StockMatrixCard(group: group) { entry in
                                    guard let sku = entry.sku else { return }
                                    stockEdit = StockEditSelection(group: group, entry: entry, sku: sku)
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Stock")
            .toolbar {
                Button {
                    Task { await store.syncFromAPI() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.isLoading)
            }
            .refreshable {
                await store.syncFromAPI()
            }
            .sheet(isPresented: $showingScanner) {
                NavigationStack {
                    BarcodeScannerView { code, _ in
                        query = code
                        showingScanner = false
                    }
                    .ignoresSafeArea()
                    .navigationTitle("Escanear")
                    .toolbar {
                        Button("Cerrar") { showingScanner = false }
                    }
                }
            }
            .sheet(item: $stockEdit) { edit in
                StockEditSheet(selection: edit) { quantity in
                    stockEdit = nil
                    Task { await store.setStockQuantity(sku: edit.sku, quantity: quantity) }
                }
            }
        }
    }
}

struct StockMatrixCard: View {
    let group: PurchaseMatrixGroup
    var onEditStock: (PurchaseMatrixEntry) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Text(group.title)
                .font(.headline.weight(.black))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .foregroundStyle(group.foregroundColor)
                .background(group.backgroundColor)

            HStack(spacing: 0) {
                ForEach(group.entries) { entry in
                    Text(entry.size)
                        .font(.title3.weight(.black))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundStyle(group.foregroundColor)
                        .background(group.backgroundColor.opacity(0.9))
                        .overlay(alignment: .trailing) {
                            Divider()
                        }
                }
            }

            HStack(spacing: 0) {
                ForEach(group.entries) { entry in
                    Button {
                        onEditStock(entry)
                    } label: {
                        Text("\(entry.currentInternalStock)")
                            .font(.system(size: 32, weight: .black))
                            .foregroundStyle(entry.currentInternalStock > 0 ? AppTheme.green : AppTheme.ink)
                            .frame(maxWidth: .infinity, minHeight: 64)
                            .background(AppTheme.surfaceStrong)
                    }
                    .buttonStyle(.plain)
                    .disabled(entry.sku == nil)
                    .overlay(alignment: .trailing) {
                        Divider()
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line, lineWidth: 1))
        .glassPanel(padding: 0)
    }
}

struct StockEditSelection: Identifiable {
    let group: PurchaseMatrixGroup
    let entry: PurchaseMatrixEntry
    let sku: String

    var id: String { "\(sku)-\(entry.size)" }
}

struct StockEditSheet: View {
    let selection: StockEditSelection
    var onSave: (Int) -> Void
    @State private var quantityText: String

    init(selection: StockEditSelection, onSave: @escaping (Int) -> Void) {
        self.selection = selection
        self.onSave = onSave
        _quantityText = State(initialValue: "\(selection.entry.currentInternalStock)")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(selection.entry.subproductName)
                        .font(.title2.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    Text("Pedidos sin preparar: \(selection.entry.pendingOrderNeed)")
                        .foregroundStyle(AppTheme.muted)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Unidades en stock")
                        .font(.headline.weight(.bold))
                    TextField("Stock", text: $quantityText)
                        .keyboardType(.numberPad)
                        .font(.system(size: 44, weight: .black))
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 12)
                        .background(AppTheme.surfaceStrong)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .glassPanel(accent: AppTheme.green)

                Text("Al guardar, Compras recalcula automaticamente lo que hay que pedir.")
                    .font(.footnote)
                    .foregroundStyle(AppTheme.muted)

                Spacer()
            }
            .padding()
            .screenBackground()
            .navigationTitle("Editar stock")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Guardar") {
                        onSave(max(0, Int(quantityText) ?? selection.entry.currentInternalStock))
                    }
                    .tint(AppTheme.green)
                }
            }
        }
    }
}

struct PurchaseMatrixView: View {
    @Environment(WorkshopStore.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Comprar")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(AppTheme.ink)
                        Text("Unidades a comprar segun pedidos sin preparar y stock actual.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Comprar", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalRecommended }, color: AppTheme.magenta, icon: "cart.badge.plus")
                        MetricTile(title: "Pedidos", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalPending }, color: AppTheme.blue, icon: "shippingbox.fill")
                        MetricTile(title: "Stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalStock }, color: AppTheme.green, icon: "archivebox.fill")
                        MetricTile(title: "Por recibir", value: store.purchaseMatrix.reduce(0) { total, group in total + group.entries.reduce(0) { $0 + $1.alreadyOrderedQuantity } }, color: AppTheme.amber, icon: "tray.and.arrow.down.fill")
                    }

                    let groups = store.purchaseMatrix.filter { $0.totalRecommended > 0 }
                    let hasIncoming = store.purchaseMatrix.contains { group in
                        group.entries.contains { $0.alreadyOrderedQuantity > 0 }
                    }
                    HStack(spacing: 10) {
                        Button {
                            Task { await store.markRecommendedPurchasesOrdered() }
                        } label: {
                            Label("Marcar compra hecha", systemImage: "cart.fill.badge.plus")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.magenta)
                        .disabled(store.purchaseMatrix.reduce(0) { $0 + $1.totalRecommended } == 0)

                        Button {
                            Task { await store.receiveAllOrderedPurchases() }
                        } label: {
                            Label("Recibir todo", systemImage: "tray.and.arrow.down.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .tint(AppTheme.green)
                        .disabled(!hasIncoming)
                    }
                    .glassPanel(padding: 12)

                    if groups.isEmpty {
                        ContentUnavailableView("No hay compras pendientes", systemImage: "checkmark.seal", description: Text("El stock actual cubre los pedidos sin preparar."))
                            .glassPanel(accent: AppTheme.green)
                    } else {
                        ForEach(groups) { group in
                            PurchaseMatrixCard(group: group, mode: .recommended)
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Compras")
            .toolbar {
                Button {
                    Task { await store.syncFromAPI() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(store.isLoading)
            }
            .refreshable {
                await store.syncFromAPI()
            }
        }
    }
}

enum PurchaseMatrixMode: String, CaseIterable, Identifiable {
    case recommended
    case pending
    case stock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recommended: "Comprar"
        case .pending: "Pedidos"
        case .stock: "Stock"
        }
    }
}

struct PurchaseMatrixCard: View {
    let group: PurchaseMatrixGroup
    let mode: PurchaseMatrixMode

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(group.title)
                    .font(.headline.weight(.black))
                Spacer()
                Text(headerTotal)
                    .font(.subheadline.weight(.black))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.24))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .foregroundStyle(group.foregroundColor)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(group.backgroundColor)
            HStack(spacing: 0) {
                ForEach(group.entries) { entry in
                    Text(entry.size)
                        .font(.subheadline.weight(.black))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(group.backgroundColor.opacity(0.88))
                        .foregroundStyle(group.foregroundColor)
                        .overlay(alignment: .trailing) {
                            Divider()
                        }
                }
            }
            HStack(spacing: 0) {
                ForEach(group.entries) { entry in
                    MatrixQuantityCell(entry: entry, mode: mode)
                }
            }
            if mode == .recommended {
                let entriesWithOrders = group.entries.filter { $0.pendingOrderNeed > 0 && !$0.demandOrders.isEmpty }
                if !entriesWithOrders.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Pedidos que necesitan estas prendas")
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppTheme.muted)
                        ForEach(entriesWithOrders) { entry in
                            PurchaseDemandLine(entry: entry)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(AppTheme.surfaceSoft)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line, lineWidth: 1))
        .glassPanel(padding: 0)
    }

    private var headerTotal: String {
        switch mode {
        case .recommended: "Comprar \(group.totalRecommended)"
        case .pending: "Pedidos \(group.totalPending)"
        case .stock: "Stock \(group.totalStock)"
        }
    }
}

struct PurchaseDemandLine: View {
    let entry: PurchaseMatrixEntry

    var groupedOrders: [(orderNumber: String, quantity: Int, titles: [String])] {
        let grouped = Dictionary(grouping: entry.demandOrders, by: \.orderNumber)
        return grouped.map { orderNumber, rows in
            (
                orderNumber: orderNumber,
                quantity: rows.reduce(0) { $0 + $1.quantity },
                titles: Array(Set(rows.map(\.title))).sorted()
            )
        }
        .sorted { $0.orderNumber < $1.orderNumber }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(entry.subproductName)
                    .font(.subheadline.weight(.black))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Text("ped \(entry.pendingOrderNeed) · comprar \(entry.recommendedPurchaseQuantity)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.magenta)
            }
            FlowChips {
                ForEach(groupedOrders, id: \.orderNumber) { order in
                    Tag(text: "\(order.orderNumber) x\(order.quantity)", systemImage: "cart.fill")
                }
            }
            ForEach(groupedOrders.prefix(3), id: \.orderNumber) { order in
                Text("\(order.orderNumber): \(order.titles.prefix(2).joined(separator: " · "))")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
            }
            if groupedOrders.count > 3 {
                Text("+\(groupedOrders.count - 3) pedidos mas")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
        }
        .padding(10)
        .background(AppTheme.surfaceStrong)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct MatrixQuantityCell: View {
    let entry: PurchaseMatrixEntry
    let mode: PurchaseMatrixMode

    var value: Int {
        switch mode {
        case .recommended: entry.recommendedPurchaseQuantity
        case .pending: entry.pendingOrderNeed
        case .stock: entry.currentInternalStock
        }
    }

    var body: some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.title3.weight(.black))
                .foregroundStyle(value > 0 && mode == .recommended ? AppTheme.magenta : AppTheme.ink)
            if mode == .recommended && entry.pendingOrderNeed > 0 {
                Text("ped \(entry.pendingOrderNeed) · stk \(entry.currentInternalStock) · ss \(entry.minStockTarget)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
            }
            if mode == .recommended && entry.alreadyOrderedQuantity > 0 {
                Text("por recibir \(entry.alreadyOrderedQuantity)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
            if mode != .recommended {
                Text(entry.subproductName.replacingOccurrences(of: "Camiseta ", with: "").replacingOccurrences(of: "Sudadera ", with: ""))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.75)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 54)
        .background(AppTheme.surfaceStrong)
        .overlay(alignment: .trailing) {
            Divider()
        }
    }
}

private extension PurchaseMatrixGroup {
    var backgroundColor: Color { Color(hex: backgroundHex) }
    var foregroundColor: Color { Color(hex: foregroundHex) }
}

private extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let red: UInt64
        let green: UInt64
        let blue: UInt64
        if cleaned.count == 6 {
            red = (value & 0xFF0000) >> 16
            green = (value & 0x00FF00) >> 8
            blue = value & 0x0000FF
        } else {
            red = 242
            green = 242
            blue = 247
        }
        self.init(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: 1)
    }
}

struct AdminView: View {
    @Environment(WorkshopStore.self) private var store

    var body: some View {
        NavigationStack {
            List {
                Section("Conexion") {
                    TextField("API URL", text: Bindable(store).apiBaseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    AdminMetric(label: "Ultima sync", value: store.lastSyncText)
                    Button {
                        Task { await store.importShopifyAndSync() }
                    } label: {
                        Label("Importar Shopify", systemImage: "arrow.clockwise")
                    }
                    if let syncError = store.syncError {
                        Text(syncError)
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
                Section("Dashboard") {
                    AdminMetric(label: "Pedidos hoy", value: "\(store.orders.count)")
                    AdminMetric(label: "Tareas criticas", value: "\(store.criticalTasks)")
                    AdminMetric(label: "Bloqueados", value: "\(store.blockedOrders)")
                    AdminMetric(label: "Listos para enviar", value: "\(store.readyForShipping)")
                }
                Section("Compras recomendadas") {
                    ForEach(store.purchaseNeeds) { need in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(need.name).font(.headline)
                            Text("\(need.supplierSku) · comprar \(need.quantity) uds · proveedor \(need.supplierAvailable)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section("Reglas de envio") {
                    Label("Correos Estandar -> 24/48h", systemImage: "clock.fill")
                    Label("Express -> mismo dia", systemImage: "flame.fill")
                    Label("Recogida local -> sin Sendcloud", systemImage: "mappin.circle.fill")
                }
                Section("Integraciones") {
                    Label("Shopify real obligatorio", systemImage: "cart.fill")
                    Label("Sendcloud real obligatorio para etiquetas", systemImage: "tag.fill")
                    Label("Falk & Ross CSV/XML preparado", systemImage: "tray.and.arrow.down.fill")
                }
                Section("Mapeos internos") {
                    NavigationLink {
                        MappingAdminView()
                    } label: {
                        Label("Productos Shopify -> ropa base", systemImage: "link.badge.plus")
                    }
                    Text("La hoja ya no manda: si falta un producto, se asigna aqui y Compras recalcula.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Admin")
        }
    }
}

struct MappingAdminView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var selections: [String: String] = [:]

    var body: some View {
        List {
            Section {
                Button {
                    Task { await store.loadMappingWorkbench() }
                } label: {
                    Label("Actualizar mapeos", systemImage: "arrow.clockwise")
                }
                if let syncError = store.syncError {
                    Text(syncError)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
            } footer: {
                Text("Shopify y la base de datos son la fuente real. La hoja no se usa para trabajar a diario.")
            }

            if let workbench = store.mappingWorkbench {
                Section("Sin mapear (\(workbench.unmapped.count))") {
                    if workbench.unmapped.isEmpty {
                        Label("Todo lo pendiente tiene subproducto asignado", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(AppTheme.green)
                    } else {
                        ForEach(workbench.unmapped) { product in
                            MappingProductRow(
                                product: product,
                                options: workbench.stockItems,
                                selection: Binding(
                                    get: { selections[product.key] ?? "" },
                                    set: { selections[product.key] = $0 }
                                )
                            ) {
                                guard let selected = selections[product.key], !selected.isEmpty else { return }
                                Task { await store.saveMapping(for: product, subproductName: selected) }
                            }
                        }
                    }
                }

                Section("Mapeos guardados") {
                    ForEach(workbench.mappings.prefix(40)) { mapping in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(mapping.productName)
                                .font(.subheadline.weight(.semibold))
                            Text(mapping.subproductName)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AppTheme.blue)
                            if !mapping.sku.isEmpty {
                                Text(mapping.sku)
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Section {
                    ContentUnavailableView("Mapeos no cargados", systemImage: "link", description: Text("Pulsa Actualizar mapeos para revisar productos pendientes."))
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .screenBackground()
        .navigationTitle("Mapeos")
        .task {
            if store.mappingWorkbench == nil {
                await store.loadMappingWorkbench()
            }
        }
        .refreshable {
            await store.loadMappingWorkbench()
        }
    }
}

struct MappingProductRow: View {
    let product: UnmappedProduct
    let options: [BlankSubproductOption]
    @Binding var selection: String
    var onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(product.productName)
                        .font(.headline)
                    Spacer()
                    Text("\(product.pendingQuantity) ud.")
                        .font(.caption.weight(.black))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(AppTheme.amber.opacity(0.18))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                Text(product.orderNumbers.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if !product.sku.isEmpty {
                    Text(product.sku)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            Picker("Ropa base", selection: $selection) {
                Text("Elegir subproducto").tag("")
                ForEach(options) { option in
                    Text(option.name).tag(option.name)
                }
            }

            Button {
                onSave()
            } label: {
                Label("Guardar mapeo", systemImage: "checkmark.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.blue)
            .disabled(selection.isEmpty)
        }
        .padding(.vertical, 6)
    }
}

struct TaskCard: View {
    let task: WorkshopTask
    let showsActions: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(task.orderNumber)
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                PriorityBadge(priority: task.priority)
            }
            Text(task.productName)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.inkSoft)
                .lineLimit(2)
            HStack(spacing: 6) {
                if !task.color.isEmpty { Tag(text: task.color, systemImage: "paintpalette.fill") }
                if !task.size.isEmpty { Tag(text: task.size, systemImage: "ruler.fill") }
                Tag(text: "\(task.quantity) ud.", systemImage: "number")
            }
            HStack(spacing: 8) {
                Label(task.deadline, systemImage: "clock.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                Spacer()
                Text(task.status.rawValue.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.4)
                    .foregroundStyle(AppTheme.muted)
            }
            if let reason = task.blockedReason {
                Label(reason, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.red)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.redSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .glassPanel(padding: 14, accent: task.priority.color)
    }
}

struct TaskRow: View {
    let task: WorkshopTask

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: task.status == .inProgress ? "play.fill" : "hammer.fill")
                .font(.headline)
                .foregroundStyle(task.priority.color)
                .frame(width: 34, height: 34)
                .background(task.priority.color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(task.orderNumber).font(.headline)
                    PriorityBadge(priority: task.priority)
                }
                Text(task.productName)
                    .lineLimit(2)
                Text("\(task.color) \(task.size) · \(task.quantity) ud. · \(task.deadline)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct PendingOrderRow: View {
    let order: WorkshopOrder
    var showsAction = true
    let markPrepared: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(order.number)
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundStyle(AppTheme.ink)
                    Text(order.customer)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                PriorityBadge(priority: order.priority)
            }
            FlowChips {
                SourceChip(source: order.source)
                StatusChip(status: order.status)
                ShippingChip(category: order.shippingCategory)
                Tag(text: order.hasMultipleItems ? "\(order.items.count) líneas · \(order.totalUnits) uds" : "\(order.totalUnits) ud", systemImage: "square.stack.3d.up.fill")
            }
            HStack(spacing: 12) {
                Label(order.shippingMethod, systemImage: "shippingbox.and.arrow.backward.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                if let created = order.createdAtShort {
                    Spacer(minLength: 0)
                    Label(created, systemImage: "calendar")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
            VStack(alignment: .leading, spacing: 7) {
                ForEach(order.items.prefix(3)) { item in
                    CompactOrderItemLine(item: item)
                }
                if order.items.count > 3 {
                    Text("+\(order.items.count - 3) artículos más dentro")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AppTheme.amber)
                }
            }
            .padding(10)
            .background(AppTheme.surfaceSoft)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            if showsAction {
                Button(action: markPrepared) {
                    Label("Pedido preparado", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.green)
                .controlSize(.large)
                .disabled(order.status == .waitingStock)
            }
        }
    }
}

// Lightweight chip flow — wraps to next line if needed
struct FlowChips<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 6) {
            content
        }
    }
}

struct OrderPreparationDetailView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var showingPrepareConfirmation = false
    @State private var showingPhotoCapture = false
    @State private var showingPrintPrompt = false
    let order: WorkshopOrder

    var currentOrder: WorkshopOrder {
        store.orders.first(where: { $0.remoteID == order.remoteID || $0.number == order.number }) ?? order
    }

    var repeatedQuantityItems: [WorkshopOrderItem] {
        currentOrder.items.filter { $0.quantity > 1 }
    }

    var pickingList: OrderPickingList? {
        store.orderPickingLists[currentOrder.remoteID ?? currentOrder.number]
    }

    var quantityWarningMessage: String {
        repeatedQuantityItems
            .map { "\($0.displayTitle): x\($0.quantity)" }
            .joined(separator: "\n")
    }

    var prepareConfirmationMessage: String {
        let lines = currentOrder.items.map { "• \($0.displayTitle) · \($0.sizeText) · x\($0.quantity)" }.joined(separator: "\n")
        if repeatedQuantityItems.isEmpty {
            return "Confirma que el paquete contiene:\n\n\(lines)"
        }
        return "OJO: hay items con 2 o mas unidades:\n\(quantityWarningMessage)\n\nConfirma que el paquete contiene:\n\n\(lines)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(currentOrder.number)
                                .font(.system(size: 34, weight: .black))
                                .foregroundStyle(AppTheme.ink)
                            Text(currentOrder.customer)
                                .font(.headline)
                                .foregroundStyle(AppTheme.muted)
                        }
                        Spacer()
                        PriorityBadge(priority: currentOrder.priority)
                    }
                    HStack(spacing: 8) {
                        SourceChip(source: currentOrder.source)
                        StatusChip(status: currentOrder.status)
                        ShippingChip(category: currentOrder.shippingCategory)
                        Tag(text: "\(currentOrder.items.count) líneas · \(currentOrder.totalUnits) uds", systemImage: "square.stack.3d.up.fill")
                    }
                    Label(currentOrder.deadline, systemImage: "clock.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(currentOrder.priority.color)
                    if let created = currentOrder.createdAtShort {
                        HStack(spacing: 6) {
                            Label(created, systemImage: "calendar")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AppTheme.muted)
                            if let rel = currentOrder.createdAtRelative {
                                Text("· \(rel)")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(AppTheme.mutedSoft)
                            }
                        }
                    }
                    Text(currentOrder.shippingMethod)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.muted)
                }
                .glassPanel(accent: currentOrder.priority.color)

                SectionHeader(title: "Qué coger", subtitle: "La app traduce cada producto Shopify a ropa base del taller")

                if let pickingList {
                    if !pickingList.unmapped.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Faltan mapeos", systemImage: "exclamationmark.triangle.fill")
                                .font(.headline.weight(.black))
                                .foregroundStyle(AppTheme.amber)
                            ForEach(pickingList.unmapped) { item in
                                Text("\(item.title) · x\(item.quantity)")
                                    .font(.subheadline.weight(.semibold))
                            }
                            Text("Asigna estos productos en Admin > Mapeos para que Compras sea exacto.")
                                .font(.caption)
                                .foregroundStyle(AppTheme.muted)
                        }
                        .glassPanel(accent: AppTheme.amber)
                    }

                    if pickingList.lines.isEmpty {
                        ContentUnavailableView("Sin ropa base", systemImage: "shippingbox", description: Text("Este pedido no tiene camisetas o sudaderas mapeadas."))
                            .glassPanel()
                    } else {
                        ForEach(pickingList.lines) { line in
                            PickingBaseLineCard(line: line)
                        }
                    }
                } else {
                    ProgressView("Calculando qué coger...")
                        .frame(maxWidth: .infinity)
                        .glassPanel()
                }

                SectionHeader(title: "Contenido del pedido", subtitle: "Revisa unidades y prendas antes de marcarlo preparado")

                if !repeatedQuantityItems.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Revisa unidades repetidas", systemImage: "exclamationmark.triangle.fill")
                            .font(.headline.weight(.black))
                            .foregroundStyle(.orange)
                        Text("Hay algun item con 2 o mas unidades. Comprueba que van todas dentro del paquete.")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.muted)
                        ForEach(repeatedQuantityItems) { item in
                            Text("\(item.displayTitle) · x\(item.quantity)")
                                .font(.subheadline.weight(.bold))
                        }
                    }
                    .glassPanel()
                }

                ForEach(currentOrder.items) { item in
                    OrderItemCard(item: item)
                }

                if currentOrder.status == .readyForLabel || currentOrder.status == .labelCreated {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(currentOrder.status == .labelCreated ? "Etiqueta creada" : "Pedido listo para envio", systemImage: "checkmark.seal.fill")
                            .font(.headline.weight(.black))
                            .foregroundStyle(.green)
                        Text("El contenido sigue visible aqui para revisar fotos, tallas y unidades aunque ya no aparezca en Sin preparar.")
                            .font(.subheadline)
                            .foregroundStyle(AppTheme.muted)
                    }
                    .glassPanel(accent: AppTheme.green)

                    Button {
                        Task { await store.reopenPreparationRemote(currentOrder) }
                    } label: {
                        Label("Deshacer preparado", systemImage: "arrow.uturn.backward.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(AppTheme.blue)
                    .controlSize(.large)
                } else {
                    Button {
                        showingPrepareConfirmation = true
                    } label: {
                        Label("Pedido preparado", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.green)
                    .controlSize(.large)
                    .disabled(currentOrder.status == .waitingStock)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle(currentOrder.number)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: currentOrder.remoteID ?? currentOrder.number) {
            await store.loadPickingList(for: currentOrder)
        }
        .alert("Confirmar pedido preparado", isPresented: $showingPrepareConfirmation) {
            Button("Cancelar", role: .cancel) {}
            Button("Sí, hacer foto y cerrar") {
                showingPhotoCapture = true
            }
            Button("Sin foto", role: .destructive) {
                Task {
                    await store.markPreparedRemote(currentOrder)
                    showingPrintPrompt = true
                }
            }
        } message: {
            Text(prepareConfirmationMessage)
        }
        .sheet(isPresented: $showingPhotoCapture) {
            NavigationStack {
                PackagePhotoCaptureView(order: currentOrder) { photo in
                    showingPhotoCapture = false
                    Task {
                        await store.markPreparedRemote(currentOrder, photo: photo)
                        showingPrintPrompt = true
                    }
                }
                .navigationTitle("Foto del paquete")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    Button("Cancelar") { showingPhotoCapture = false }
                }
            }
        }
        .alert("Imprimir etiqueta", isPresented: $showingPrintPrompt) {
            Button("Sí, crear e imprimir") {
                Task { await store.createLabelRemote(for: currentOrder) }
            }
            Button("Más tarde", role: .cancel) {}
        } message: {
            Text("Pedido marcado como preparado.\n¿Crear etiqueta de envío e imprimirla ahora?")
        }
    }
}

struct PickingBaseLineCard: View {
    let line: OrderPickingLine

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(line.subproductName)
                        .font(.title3.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    Text("Stock ahora: \(line.stockAvailable)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(line.stockAvailable >= line.quantity ? AppTheme.green : AppTheme.red)
                }
                Spacer()
                Text("x\(line.quantity)")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                    .foregroundStyle(AppTheme.blue)
            }
            FlowChips {
                Tag(text: line.color, systemImage: "paintpalette.fill")
                Tag(text: line.size, systemImage: "ruler.fill")
                if let sku = line.sku {
                    Tag(text: sku, systemImage: "barcode")
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(line.orderItems) { item in
                    Text("\(item.title) · x\(item.quantity)")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                }
            }
            if line.quantity > 1 {
                Label("Revisa: hay \(line.quantity) unidades de esta prenda base", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
        }
        .glassPanel(accent: line.stockAvailable >= line.quantity ? AppTheme.blue : AppTheme.red)
    }
}

struct PackagePhotoCaptureView: UIViewControllerRepresentable {
    let order: WorkshopOrder
    var onPhoto: (Data?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPhoto: onPhoto) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
            picker.cameraCaptureMode = .photo
        } else {
            picker.sourceType = .photoLibrary
        }
        picker.allowsEditing = false
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onPhoto: (Data?) -> Void
        init(onPhoto: @escaping (Data?) -> Void) { self.onPhoto = onPhoto }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
            let image = info[.originalImage] as? UIImage
            let data = Self.compressedJPEG(image)
            picker.dismiss(animated: true) { self.onPhoto(data) }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true) { self.onPhoto(nil) }
        }

        private static func compressedJPEG(_ image: UIImage?) -> Data? {
            guard let image else { return nil }
            let maxDimension: CGFloat = 1280
            let scale = min(1, maxDimension / max(image.size.width, image.size.height))
            let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            UIGraphicsBeginImageContextWithOptions(newSize, true, 1)
            image.draw(in: CGRect(origin: .zero, size: newSize))
            let resized = UIGraphicsGetImageFromCurrentImageContext()
            UIGraphicsEndImageContext()
            return (resized ?? image).jpegData(compressionQuality: 0.6)
        }
    }
}

struct OrderItemCard: View {
    let item: WorkshopOrderItem

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.sizeText)
                        .font(.system(size: 46, weight: .black))
                        .foregroundStyle(AppTheme.blue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                    Text(item.quantity == 1 ? "x1 unidad" : "x\(item.quantity) unidades")
                        .font(.title2.weight(.black))
                        .foregroundStyle(item.quantity > 1 ? AppTheme.amber : AppTheme.muted)
                }
                .frame(width: 112, alignment: .leading)
                Spacer()
                if item.quantity > 1 {
                    Label("Revisar", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.black))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.orange.opacity(0.14))
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }
            }

            ProductImageStrip(item: item)

            VStack(alignment: .leading, spacing: 8) {
                Text(item.displayTitle)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(3)
                if !item.detailLine.isEmpty {
                    Text(item.detailLine)
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.muted)
                }
            }
        }
        .glassPanel(padding: 14, accent: item.quantity > 1 ? AppTheme.amber : AppTheme.blue.opacity(0.8))
    }
}

struct ProductImageStrip: View {
    let item: WorkshopOrderItem
    @State private var selectedImage: ProductPreview?

    var previews: [ProductPreview] {
        let labels = ["Frontal", "Espalda"]
        let urls = item.imageURLs.isEmpty ? [item.imageURL].compactMap { $0 } : item.imageURLs
        return urls.prefix(2).enumerated().map { index, url in
            ProductPreview(label: labels.indices.contains(index) ? labels[index] : "Imagen \(index + 1)", url: url)
        }
    }

    var body: some View {
        if previews.isEmpty {
            ProductImageView(url: nil, title: item.title)
                .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: previews.count == 1 ? 1 : 2), spacing: 10) {
                ForEach(previews) { preview in
                    Button {
                        selectedImage = preview
                    } label: {
                        ZStack(alignment: .topLeading) {
                            ProductImageView(url: preview.url, title: item.title)
                                .frame(height: 230)
                            Text(preview.label)
                                .font(.caption.weight(.black))
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(.ultraThinMaterial)
                                .clipShape(RoundedRectangle(cornerRadius: 7))
                                .padding(8)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(item: $selectedImage) { preview in
                NavigationStack {
                    ZStack {
                        Color(.systemBackground).ignoresSafeArea()
                        ProductImageView(url: preview.url, title: item.title)
                            .padding()
                    }
                    .navigationTitle(preview.label)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            Button("Cerrar") { selectedImage = nil }
                        }
                }
            }
        }
    }
}

struct ProductPreview: Identifiable {
    var id: URL { url }
    let label: String
    let url: URL
}

struct CompactOrderItemLine: View {
    let item: WorkshopOrderItem

    var body: some View {
        HStack(spacing: 10) {
            ProductImageView(url: item.imageURL, title: item.title)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.displayTitle)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                if !item.detailLine.isEmpty {
                    Text(item.detailLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 0) {
                Text(item.sizeText)
                    .font(.title2.weight(.black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("x\(item.quantity)")
                    .font(.headline.weight(.black))
                    .foregroundStyle(item.quantity > 1 ? .orange : .secondary)
            }
        }
    }
}

struct ProductImageView: View {
    let url: URL?
    let title: String

    var initials: String {
        title
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first }
            .map(String.init)
            .joined()
            .uppercased()
    }

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        placeholder
                    case .empty:
                        ProgressView()
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line, lineWidth: 1))
    }

    private var placeholder: some View {
        ZStack {
            LinearGradient(colors: [AppTheme.blue.opacity(0.10), AppTheme.amber.opacity(0.10)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(initials.isEmpty ? "?" : initials)
                .font(.headline.weight(.black))
                .foregroundStyle(AppTheme.muted)
        }
    }
}

struct MetricTile: View {
    let title: String
    let value: Int
    let color: Color
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(color)
                    .frame(width: 28, height: 28)
                    .background(color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(title.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(0.6)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Spacer(minLength: 0)
            }
            Text("\(value)")
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(AppTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(padding: 14)
    }
}

// Shared pill style for any status/badge
struct StatusPill: View {
    let text: String
    let systemImage: String?
    let foreground: Color
    let background: Color
    let border: Color
    var compact: Bool = false

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 10, weight: .bold))
            }
            Text(text)
                .font(.caption2.weight(.bold))
                .tracking(0.3)
                .lineLimit(1)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.vertical, compact ? 4 : 5)
        .background(background)
        .overlay(Capsule().stroke(border, lineWidth: 0.8))
        .clipShape(Capsule())
    }
}

struct PriorityBadge: View {
    let priority: PriorityLevel

    var body: some View {
        StatusPill(
            text: priority.rawValue,
            systemImage: nil,
            foreground: priority.color,
            background: priority.softColor,
            border: priority.color.opacity(0.25)
        )
    }
}

struct StatusChip: View {
    let status: OrderStatus

    var body: some View {
        StatusPill(
            text: status.label.uppercased(),
            systemImage: icon,
            foreground: foreground,
            background: softBackground,
            border: foreground.opacity(0.22)
        )
    }

    private var foreground: Color {
        switch status {
        case .readyForLabel, .labelCreated, .shipped: AppTheme.green
        case .waitingStock: AppTheme.magenta
        case .inProduction, .produced, .picked: AppTheme.blue
        case .cancelled: AppTheme.muted
        default: AppTheme.amber
        }
    }

    private var softBackground: Color {
        switch status {
        case .readyForLabel, .labelCreated, .shipped: AppTheme.greenSoft
        case .waitingStock: AppTheme.magentaSoft
        case .inProduction, .produced, .picked: AppTheme.blueSoft
        case .cancelled: AppTheme.surfaceTinted
        default: AppTheme.amberSoft
        }
    }

    private var icon: String {
        switch status {
        case .readyForLabel, .labelCreated: "checkmark.seal.fill"
        case .shipped: "paperplane.fill"
        case .waitingStock: "exclamationmark.triangle.fill"
        case .inProduction, .produced, .picked: "gearshape.2.fill"
        case .cancelled: "xmark.circle.fill"
        default: "shippingbox.fill"
        }
    }
}

struct ShippingChip: View {
    let category: ShippingCategory

    var body: some View {
        StatusPill(
            text: category.rawValue.uppercased(),
            systemImage: icon,
            foreground: foreground,
            background: background,
            border: foreground.opacity(0.22)
        )
    }

    private var icon: String {
        switch category {
        case .premium: "bolt.fill"
        case .standard: "shippingbox.fill"
        case .free: "gift.fill"
        }
    }

    private var foreground: Color {
        switch category {
        case .premium: AppTheme.amber
        case .standard: AppTheme.blue
        case .free: AppTheme.green
        }
    }

    private var background: Color {
        switch category {
        case .premium: AppTheme.amberSoft
        case .standard: AppTheme.blueSoft
        case .free: AppTheme.greenSoft
        }
    }
}

struct SourceChip: View {
    let source: WorkshopOrder.Source

    var body: some View {
        let isShopify = source == .shopify
        StatusPill(
            text: source.rawValue.uppercased(),
            systemImage: source.icon,
            foreground: isShopify ? AppTheme.green : AppTheme.purple,
            background: isShopify ? AppTheme.greenSoft : AppTheme.purpleSoft,
            border: (isShopify ? AppTheme.green : AppTheme.purple).opacity(0.22)
        )
    }
}

struct PrintStatusChip: View {
    let status: WorkshopOrder.PrintStatus

    var body: some View {
        switch status {
        case .none:
            EmptyView()
        case .pending:
            StatusPill(
                text: "PENDIENTE IMPRIMIR",
                systemImage: "printer.fill",
                foreground: AppTheme.amber,
                background: AppTheme.amberSoft,
                border: AppTheme.amber.opacity(0.22)
            )
        case .printed:
            StatusPill(
                text: "IMPRESA",
                systemImage: "checkmark.circle.fill",
                foreground: AppTheme.green,
                background: AppTheme.greenSoft,
                border: AppTheme.green.opacity(0.22)
            )
        }
    }
}

struct Tag: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(AppTheme.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(AppTheme.surfaceSoft)
            .overlay(Capsule().stroke(AppTheme.line, lineWidth: 0.8))
            .clipShape(Capsule())
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 19, weight: .heavy, design: .rounded))
                .foregroundStyle(AppTheme.ink)
            Text(subtitle)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AppTheme.muted)
        }
        .padding(.top, 4)
    }
}

struct InfoPanel: View {
    let title: String
    let rows: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline.weight(.black))
                .foregroundStyle(AppTheme.ink)
            ForEach(rows, id: \.self) { row in
                Label(row, systemImage: "circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(padding: 16)
    }
}

struct StockRowView: View {
    let row: StockRow

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.sku).font(.headline)
                Text(row.name).foregroundStyle(.secondary)
                Text(row.location).font(.caption.weight(.semibold))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(row.quantity)")
                    .font(.title2.weight(.black))
                    .foregroundStyle(row.quantity <= row.minStock ? .red : .primary)
                Text("min \(row.minStock)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
    }
}

struct AdminMetric: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
            Spacer()
            Text(value)
                .font(.headline)
        }
    }
}

struct SyncStatusView: View {
    @Environment(WorkshopStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle()
                    .fill(store.isAPIConnected ? AppTheme.green : AppTheme.amber)
                    .frame(width: 8, height: 8)
                    .overlay(
                        Circle()
                            .stroke((store.isAPIConnected ? AppTheme.green : AppTheme.amber).opacity(0.25), lineWidth: 4)
                    )
                Text(store.isAPIConnected ? "API conectada" : "API sin conexión")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.inkSoft)
                Spacer()
                if store.isLoading {
                    ProgressView().controlSize(.small)
                } else {
                    Label(store.lastSyncText, systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
            if let syncError = store.syncError {
                Label(syncError, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.amber)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.amberSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .glassPanel(padding: 12, accent: store.isAPIConnected ? AppTheme.green : AppTheme.amber)
    }
}

struct GlassPanelModifier: ViewModifier {
    let padding: CGFloat
    let accent: Color?

    func body(content: Content) -> some View {
        HStack(spacing: 0) {
            if let accent {
                Rectangle()
                    .fill(accent)
                    .frame(width: 3)
            }
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(AppTheme.surface))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(AppTheme.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: Color.black.opacity(0.04), radius: 14, x: 0, y: 6)
        .shadow(color: Color.black.opacity(0.02), radius: 2, x: 0, y: 1)
    }
}

struct ScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        ZStack {
            // Base canvas
            AppTheme.canvasTop.ignoresSafeArea()
            // Subtle indigo wash top-trailing
            LinearGradient(
                colors: [AppTheme.blue.opacity(0.08), Color.clear],
                startPoint: .topTrailing,
                endPoint: .center
            )
            .ignoresSafeArea()
            // Subtle teal wash bottom-leading
            LinearGradient(
                colors: [Color.clear, AppTheme.teal.opacity(0.06)],
                startPoint: .center,
                endPoint: .bottomLeading
            )
            .ignoresSafeArea()
            content
        }
    }
}

extension View {
    func glassPanel(padding: CGFloat = 16, accent: Color? = nil) -> some View {
        modifier(GlassPanelModifier(padding: padding, accent: accent))
    }

    func screenBackground() -> some View {
        modifier(ScreenBackgroundModifier())
    }
}

struct ActiveFilterChip: View {
    let text: String
    let icon: String
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.caption2.weight(.bold))
            Text(text)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Button(action: onClear) {
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(AppTheme.blue)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(AppTheme.blueSoft)
        .overlay(Capsule().stroke(AppTheme.blue.opacity(0.25), lineWidth: 0.8))
        .clipShape(Capsule())
    }
}

struct EconomicsView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var today: EconomicsSummary?
    @State private var month: EconomicsSummary?
    @State private var products: [ProductMarginRow] = []
    @State private var loading = false
    @State private var error: String?
    @State private var range: Range = .today

    enum Range: String, CaseIterable, Identifiable {
        case today, month
        var id: String { rawValue }
        var label: String {
            switch self { case .today: "Hoy"; case .month: "Este mes" }
        }
    }

    var current: EconomicsSummary? {
        switch range { case .today: today; case .month: month }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Economía")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Ingresos, costes y reserva para envíos.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    Picker("Rango", selection: $range) {
                        ForEach(Range.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    if loading && current == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let summary = current {
                        ShippingReserveCard(summary: summary)
                        EconomicsSummaryCard(summary: summary)
                        OrdersBreakdownSection(summary: summary)
                    }

                    if !products.isEmpty {
                        SectionHeader(title: "Margen por producto", subtitle: "Top 10 con mejor margen acumulado")
                        ForEach(products.prefix(10)) { row in
                            ProductMarginRowView(row: row)
                        }
                    }

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(AppTheme.red)
                            .padding(10)
                            .glassPanel(padding: 10, accent: AppTheme.red)
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Economía")
            .toolbar {
                Button { Task { await reload() } } label: {
                    Image(systemName: "arrow.clockwise")
                }.disabled(loading)
            }
            .task { await reload() }
            .refreshable { await reload() }
        }
    }

    private func reload() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            async let t = client.economicsToday()
            async let m = client.economicsMonth()
            async let p = client.economicsProducts()
            today = try await t
            month = try await m
            products = try await p
        } catch let err {
            error = err.localizedDescription
        }
    }
}

struct ShippingReserveCard: View {
    let summary: EconomicsSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "shippingbox.and.arrow.backward.fill")
                    .font(.title3)
                    .foregroundStyle(AppTheme.amber)
                Text("Reserva envíos")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
                    .textCase(.uppercase)
                Spacer()
            }
            Text(formatMoney(summary.shippingReserve, currency: summary.currency))
                .font(.system(size: 36, weight: .heavy, design: .rounded))
                .foregroundStyle(AppTheme.amber)
            Text("Aparta esta cantidad de las ventas para pagar Sendcloud (\(summary.orderCount) pedido\(summary.orderCount == 1 ? "" : "s")).")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .glassPanel(padding: 16, accent: AppTheme.amber)
    }
}

struct EconomicsSummaryCard: View {
    let summary: EconomicsSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                MoneyTile(label: "Ingresos", value: summary.grossRevenue, currency: summary.currency, color: AppTheme.green)
                MoneyTile(label: "Neto", value: summary.netMargin, currency: summary.currency, color: summary.netMargin >= 0 ? AppTheme.blue : AppTheme.red)
            }
            Divider().background(AppTheme.line)
            CostRow(label: "Coste producto", value: summary.productCost, currency: summary.currency)
            CostRow(label: "Coste envíos", value: summary.shippingCost, currency: summary.currency)
            CostRow(label: "Comisión Shopify (2.4%)", value: summary.shopifyFee, currency: summary.currency)
            if let pct = summary.netMarginPct {
                HStack {
                    Text("Margen %")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                    Spacer()
                    Text(String(format: "%.1f%%", pct))
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(pct >= 0 ? AppTheme.green : AppTheme.red)
                }
            }
        }
        .glassPanel(padding: 16)
    }
}

struct MoneyTile: View {
    let label: String
    let value: Double
    let currency: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.5)
                .foregroundStyle(AppTheme.muted)
            Text(formatMoney(value, currency: currency))
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct CostRow: View {
    let label: String
    let value: Double
    let currency: String

    var body: some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(AppTheme.inkSoft)
            Spacer()
            Text(formatMoney(value, currency: currency))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(AppTheme.muted)
        }
    }
}

struct OrdersBreakdownSection: View {
    let summary: EconomicsSummary

    var body: some View {
        if summary.orders.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Pedidos", subtitle: "\(summary.orders.count) pedido\(summary.orders.count == 1 ? "" : "s") en el rango")
                ForEach(summary.orders) { order in
                    OrderBreakdownRow(order: order)
                }
            }
        }
    }
}

struct OrderBreakdownRow: View {
    let order: OrderBreakdown

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(order.orderNumber)
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Text(formatMoney(order.netMargin, currency: order.currency))
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(order.netMargin >= 0 ? AppTheme.green : AppTheme.red)
            }
            Text(order.customer)
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
            HStack(spacing: 8) {
                Tag(text: "Ing \(formatMoneyShort(order.grossRevenue))", systemImage: "arrow.down.circle.fill")
                Tag(text: "Prod \(formatMoneyShort(order.productCost))", systemImage: "scissors")
                Tag(text: "Env \(formatMoneyShort(order.shippingCost))", systemImage: "shippingbox.fill")
            }
            if !order.shipmentCostKnown {
                Label("Coste envío estimado", systemImage: "questionmark.circle")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.amber)
            }
            if !order.hasItemPrices {
                Label("Sin precios — re-sincroniza Shopify", systemImage: "arrow.clockwise")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .glassPanel(padding: 14, accent: order.netMargin >= 0 ? AppTheme.green : AppTheme.red)
    }
}

struct ProductMarginRowView: View {
    let row: ProductMarginRow

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.title).font(.subheadline.weight(.bold)).foregroundStyle(AppTheme.ink).lineLimit(1)
                Text("\(row.quantity) ud · \(row.sku)").font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(formatMoneyShort(row.margin))
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(row.margin >= 0 ? AppTheme.green : AppTheme.red)
                if let pct = row.marginPct {
                    Text(String(format: "%.0f%%", pct))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                }
            }
        }
        .glassPanel(padding: 12)
    }
}

func formatMoney(_ value: Double, currency: String = "EUR") -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    formatter.locale = Locale(identifier: "es_ES")
    return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)
}

func formatMoneyShort(_ value: Double) -> String {
    String(format: "%.0f€", value)
}

struct FinalizedView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var shipments: [FinalizedShipment] = []
    @State private var loading = false
    @State private var error: String?
    @State private var search = ""

    var filtered: [FinalizedShipment] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return shipments }
        return shipments.filter {
            $0.orderNumber.localizedCaseInsensitiveContains(q) ||
            $0.customer.localizedCaseInsensitiveContains(q) ||
            ($0.trackingNumber ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Finalizados")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Pedidos con etiqueta o ya enviados, con foto del paquete y tracking.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass").foregroundStyle(AppTheme.muted)
                        TextField("Buscar pedido, cliente o tracking", text: $search)
                            .textInputAutocapitalization(.never)
                        if !search.isEmpty {
                            Button { search = "" } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(AppTheme.muted)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(AppTheme.surfaceSoft)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.line))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    if loading && shipments.isEmpty {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if filtered.isEmpty {
                        ContentUnavailableView(
                            "Sin finalizados",
                            systemImage: "tray",
                            description: Text("Cuando escanees una etiqueta aparecerá aquí con su foto y tracking.")
                        )
                        .glassPanel()
                    } else {
                        LazyVStack(spacing: 10) {
                            ForEach(filtered) { shipment in
                                NavigationLink(value: shipment) {
                                    FinalizedRow(shipment: shipment)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(AppTheme.red)
                            .padding(10).glassPanel(padding: 10, accent: AppTheme.red)
                    }
                }
                .padding()
            }
            .screenBackground()
            .globalSearch()
            .navigationTitle("Finalizados")
            .toolbar {
                Button { Task { await reload() } } label: {
                    Image(systemName: "arrow.clockwise")
                }.disabled(loading)
            }
            .task { await reload() }
            .refreshable { await reload() }
            .navigationDestination(for: FinalizedShipment.self) { shipment in
                FinalizedDetailView(shipment: shipment)
            }
        }
    }

    private func reload() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true; defer { loading = false }
        error = nil
        do {
            shipments = try await client.finalizedShipments()
        } catch let err {
            error = err.localizedDescription
        }
    }
}

extension FinalizedShipment: Hashable {
    static func == (lhs: FinalizedShipment, rhs: FinalizedShipment) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct FinalizedRow: View {
    @Environment(WorkshopStore.self) private var store
    let shipment: FinalizedShipment

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if shipment.hasPhoto, let url = store.apiClient?.packagePhotoURL(shipmentId: shipment.id) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    case .failure: photoPlaceholder
                    case .empty: ProgressView()
                    @unknown default: photoPlaceholder
                    }
                }
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            } else {
                photoPlaceholder.frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(shipment.orderNumber)
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Spacer()
                    statusBadge
                }
                Text(shipment.customer).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                if let track = shipment.trackingNumber {
                    Label(track, systemImage: "barcode.viewfinder")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AppTheme.teal)
                        .lineLimit(1)
                }
                if let live = shipment.trackingStatus, !live.isEmpty {
                    Text(translateShipmentStatus(live))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
            }
        }
        .glassPanel(padding: 12)
    }

    private var photoPlaceholder: some View {
        ZStack {
            AppTheme.surfaceSoft
            Image(systemName: "photo")
                .foregroundStyle(AppTheme.mutedSoft)
        }
    }

    private var statusBadge: some View {
        let raw = shipment.status.uppercased()
        let color: Color
        let label: String
        switch raw {
        case "DELIVERED": label = "ENTREGADO"; color = AppTheme.green
        case "SHIPPED": label = "ENVIADO"; color = AppTheme.green
        case "IN_TRANSIT": label = "EN TRÁNSITO"; color = AppTheme.blue
        case "PRINTED": label = "IMPRESA"; color = AppTheme.teal
        case "LABEL_CREATED": label = "ETIQUETA CREADA"; color = AppTheme.amber
        case "PARCEL_CREATED": label = "PAQUETE CREADO"; color = AppTheme.amber
        case "PENDING": label = "PENDIENTE"; color = AppTheme.muted
        case "CANCELLED": label = "CANCELADO"; color = AppTheme.muted
        case "ERROR": label = "ERROR"; color = AppTheme.red
        default: label = raw.replacingOccurrences(of: "_", with: " "); color = AppTheme.amber
        }
        return StatusPill(
            text: label,
            systemImage: "circle.fill",
            foreground: color,
            background: color.opacity(0.18),
            border: color.opacity(0.25),
            compact: true
        )
    }
}

func translateShipmentStatus(_ raw: String) -> String {
    switch raw.uppercased() {
    case "DELIVERED": return "Entregado"
    case "SHIPPED": return "Enviado"
    case "IN_TRANSIT": return "En tránsito"
    case "PRINTED": return "Etiqueta impresa"
    case "LABEL_CREATED": return "Etiqueta creada"
    case "PARCEL_CREATED": return "Paquete creado"
    case "PENDING": return "Pendiente"
    case "CANCELLED": return "Cancelado"
    case "ERROR": return "Error"
    default: return raw.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct FinalizedDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let shipment: FinalizedShipment
    @State private var tracking: ShipmentTrackingResponse?
    @State private var loading = false
    @State private var error: String?
    @State private var timer: Timer?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(shipment.orderNumber)
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(AppTheme.ink)
                    Text(shipment.customer)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                    if let track = shipment.trackingNumber {
                        Label(track, systemImage: "barcode.viewfinder")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AppTheme.teal)
                    }
                }
                .glassPanel(padding: 16)

                if shipment.hasPhoto, let url = store.apiClient?.packagePhotoURL(shipmentId: shipment.id) {
                    SectionHeader(title: "Foto del paquete", subtitle: "Tomada al escanear la etiqueta")
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image): image.resizable().scaledToFit()
                        case .failure: Color.clear
                        case .empty: ProgressView()
                        @unknown default: Color.clear
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .glassPanel(padding: 0)
                }

                Button {
                    Task { await store.reprintLabelByShipment(shipment.id) }
                } label: {
                    Label("Reimprimir etiqueta", systemImage: "printer.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.amber)
                .controlSize(.large)

                SectionHeader(title: "Seguimiento en tiempo real", subtitle: "Se actualiza cada 30 s automáticamente")
                trackingPanel
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle(shipment.orderNumber)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = shipment.trackingUrl, let u = URL(string: url) {
                Link(destination: u) {
                    Image(systemName: "safari.fill")
                }
            }
        }
        .task { await load() }
        .onAppear {
            timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
                Task { await load() }
            }
        }
        .onDisappear { timer?.invalidate(); timer = nil }
    }

    @ViewBuilder
    private var trackingPanel: some View {
        if loading && tracking == nil {
            ProgressView().frame(maxWidth: .infinity).padding().glassPanel()
        } else if let track = tracking {
            VStack(alignment: .leading, spacing: 10) {
                if let status = track.status, !status.isEmpty {
                    Label(translateShipmentStatus(status), systemImage: "shippingbox.fill")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(AppTheme.ink)
                }
                if let carrier = track.carrier, !carrier.isEmpty {
                    Label(carrier, systemImage: "truck.box.fill")
                        .font(.caption).foregroundStyle(AppTheme.muted)
                }
                if track.events.isEmpty {
                    Text("Aún sin eventos del transportista.")
                        .font(.caption).foregroundStyle(AppTheme.muted)
                } else {
                    Divider().background(AppTheme.line)
                    ForEach(track.events) { event in
                        HStack(alignment: .top, spacing: 10) {
                            Circle().fill(AppTheme.teal).frame(width: 8, height: 8).padding(.top, 6)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(translateShipmentStatus(event.status ?? event.message ?? "Evento"))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(AppTheme.ink)
                                if let at = event.at {
                                    Text(at).font(.caption2).foregroundStyle(AppTheme.muted)
                                }
                                if let m = event.message, m != event.status {
                                    Text(m).font(.caption).foregroundStyle(AppTheme.muted)
                                }
                            }
                            Spacer()
                        }
                    }
                }
                if let err = track.error {
                    Text(err).font(.caption2).foregroundStyle(AppTheme.amber)
                }
            }
            .glassPanel(padding: 16)
        } else if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(AppTheme.red)
                .padding().glassPanel(padding: 12, accent: AppTheme.red)
        }
    }

    private func load() async {
        guard let client = store.apiClient else { return }
        loading = true; defer { loading = false }
        do {
            tracking = try await client.shipmentTracking(shipment.id)
        } catch let err {
            error = err.localizedDescription
        }
    }
}

struct GlobalSearchSheet: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    enum Result: Identifiable, Hashable {
        case order(WorkshopOrder)
        case task(WorkshopTask)
        case stock(UUID)

        var id: String {
            switch self {
            case .order(let o): "order-\(o.id)"
            case .task(let t): "task-\(t.id)"
            case .stock(let id): "stock-\(id)"
            }
        }
    }

    var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var orderHits: [WorkshopOrder] {
        guard !trimmed.isEmpty else { return [] }
        return store.orders.filter { matchesOrder($0, query: trimmed) }
            .prefix(20).map { $0 }
    }

    var taskHits: [WorkshopTask] {
        guard !trimmed.isEmpty else { return [] }
        return store.tasks.filter { matchesTask($0, query: trimmed) }
            .prefix(20).map { $0 }
    }

    var stockHits: [StockRow] {
        guard !trimmed.isEmpty else { return [] }
        return store.stock.filter {
            $0.sku.localizedCaseInsensitiveContains(trimmed) ||
            $0.name.localizedCaseInsensitiveContains(trimmed) ||
            $0.location.localizedCaseInsensitiveContains(trimmed)
        }
        .prefix(20).map { $0 }
    }

    var hasResults: Bool { !orderHits.isEmpty || !taskHits.isEmpty || !stockHits.isEmpty }

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.canvasTop.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass").foregroundStyle(AppTheme.muted)
                            TextField("Pedido, cliente, SKU, tracking…", text: $query)
                                .textInputAutocapitalization(.never)
                                .submitLabel(.search)
                            if !query.isEmpty {
                                Button { query = "" } label: {
                                    Image(systemName: "xmark.circle.fill").foregroundStyle(AppTheme.muted)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 12)
                        .background(AppTheme.surfaceSoft)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppTheme.line))
                        .clipShape(RoundedRectangle(cornerRadius: 12))

                        if trimmed.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Sugerencias")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(AppTheme.muted)
                                    .textCase(.uppercase)
                                SuggestionChip("Nº pedido (ej. 9464)", icon: "shippingbox.fill")
                                SuggestionChip("Cliente o email", icon: "person.fill")
                                SuggestionChip("SKU o tracking", icon: "barcode")
                            }
                            .padding(.top, 6)
                        }

                        if !orderHits.isEmpty {
                            SectionHeader(title: "Pedidos", subtitle: "\(orderHits.count) resultado\(orderHits.count == 1 ? "" : "s")")
                            LazyVStack(spacing: 8) {
                                ForEach(orderHits) { order in
                                    NavigationLink(value: Result.order(order)) {
                                        SearchOrderRow(order: order, query: trimmed)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        if !taskHits.isEmpty {
                            SectionHeader(title: "Producción", subtitle: "\(taskHits.count) resultado\(taskHits.count == 1 ? "" : "s")")
                            LazyVStack(spacing: 8) {
                                ForEach(taskHits) { task in
                                    NavigationLink(value: Result.task(task)) {
                                        SearchTaskRow(task: task)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        if !stockHits.isEmpty {
                            SectionHeader(title: "Stock", subtitle: "\(stockHits.count) resultado\(stockHits.count == 1 ? "" : "s")")
                            LazyVStack(spacing: 8) {
                                ForEach(stockHits) { row in
                                    SearchStockRow(row: row)
                                }
                            }
                        }

                        if !trimmed.isEmpty && !hasResults {
                            ContentUnavailableView(
                                "Sin resultados",
                                systemImage: "magnifyingglass",
                                description: Text("No encontramos «\(trimmed)» en pedidos, producción o stock.")
                            )
                            .glassPanel()
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Buscar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cerrar") { dismiss() }
                }
            }
            .navigationDestination(for: Result.self) { result in
                switch result {
                case .order(let o): OrderPreparationDetailView(order: o)
                case .task(let t): TaskDetailView(task: t)
                case .stock: EmptyView()
                }
            }
        }
    }

    private func matchesOrder(_ order: WorkshopOrder, query: String) -> Bool {
        order.number.localizedCaseInsensitiveContains(query) ||
        order.customer.localizedCaseInsensitiveContains(query) ||
        order.shippingMethod.localizedCaseInsensitiveContains(query) ||
        (order.tracking ?? "").localizedCaseInsensitiveContains(query) ||
        order.items.contains {
            $0.sku.localizedCaseInsensitiveContains(query) ||
            $0.title.localizedCaseInsensitiveContains(query) ||
            ($0.variantTitle ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    private func matchesTask(_ task: WorkshopTask, query: String) -> Bool {
        task.orderNumber.localizedCaseInsensitiveContains(query) ||
        task.productName.localizedCaseInsensitiveContains(query) ||
        task.sku.localizedCaseInsensitiveContains(query)
    }
}

struct SuggestionChip: View {
    let text: String
    let icon: String
    init(_ text: String, icon: String) { self.text = text; self.icon = icon }
    var body: some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(AppTheme.muted)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.surfaceSoft)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(AppTheme.lineSoft))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

struct SearchOrderRow: View {
    let order: WorkshopOrder
    let query: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "shippingbox.fill")
                .foregroundStyle(order.priority.color)
                .frame(width: 36, height: 36)
                .background(order.priority.softColor)
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(order.number).font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.ink)
                Text(order.customer).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
            }
            Spacer()
            StatusChip(status: order.status)
        }
        .glassPanel(padding: 10, accent: order.priority.color)
    }
}

struct SearchTaskRow: View {
    let task: WorkshopTask

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "hammer.fill")
                .foregroundStyle(task.priority.color)
                .frame(width: 36, height: 36)
                .background(task.priority.softColor)
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(task.orderNumber).font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.ink)
                Text(task.productName).font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
            }
            Spacer()
            PriorityBadge(priority: task.priority)
        }
        .glassPanel(padding: 10, accent: task.priority.color)
    }
}

struct SearchStockRow: View {
    let row: StockRow

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "archivebox.fill")
                .foregroundStyle(row.quantity <= row.minStock ? AppTheme.red : AppTheme.green)
                .frame(width: 36, height: 36)
                .background((row.quantity <= row.minStock ? AppTheme.redSoft : AppTheme.greenSoft))
                .clipShape(RoundedRectangle(cornerRadius: 9))
            VStack(alignment: .leading, spacing: 2) {
                Text(row.name).font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.ink).lineLimit(1)
                Text("\(row.sku) · \(row.location)").font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
            }
            Spacer()
            Text("×\(row.quantity)")
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(row.quantity <= row.minStock ? AppTheme.red : AppTheme.ink)
        }
        .glassPanel(padding: 10)
    }
}

struct GlobalSearchToolbarModifier: ViewModifier {
    @State private var showing = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showing = true } label: {
                        Image(systemName: "magnifyingglass")
                    }
                }
            }
            .sheet(isPresented: $showing) {
                GlobalSearchSheet()
            }
    }
}

extension View {
    func globalSearch() -> some View { modifier(GlobalSearchToolbarModifier()) }
}

#Preview {
    ContentView()
}
