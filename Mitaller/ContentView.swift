//
//  ContentView.swift
//  Mitaller
//
//  Created by Angel Velasco on 5/5/26.
//

import SwiftUI
import UIKit
import PDFKit
import UniformTypeIdentifiers
@preconcurrency import Vision

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

    var stockAlreadyPicked: Bool {
        switch self {
        case .inProduction, .produced, .picked, .readyForLabel, .labelCreated, .shipped:
            true
        default:
            false
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

extension WorkshopOrder {
    static let placeholderForPhoto = WorkshopOrder(
        number: "ALBARAN",
        customer: "Entrada de stock",
        shippingMethod: "",
        status: .new,
        priority: .normal,
        deadline: "",
        items: []
    )
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
    var id: String { stockItemId ?? "\(sku ?? "")-\(subproductName)-\(size)" }
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
    let imageRef: String?
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

struct StockReceipt: Decodable, Identifiable {
    let id: String
    let status: String
    let createdAt: Date?
    let confirmedAt: Date?
    let lines: [StockReceiptLine]
}

struct StockReceiptLine: Decodable, Identifiable, Hashable {
    let id: String
    let stockItemId: String?
    let detectedName: String
    let matchedName: String?
    let sku: String?
    let supplierSku: String?
    let quantity: Int
    let confidence: Double?
    let rawLine: String?
}

struct StockReceiptConfirmLine: Encodable, Hashable {
    let id: String?
    let stockItemId: String?
    var quantity: Int
    let detectedName: String?

    var stableId: String { id ?? "\(stockItemId ?? "manual")-\(detectedName ?? "")" }
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
    var isBatchProcessing = false
    var batchProgressText: String?
    private var didBootstrap = false
    var tasks: [WorkshopTask] = []
    var orders: [WorkshopOrder] = []
    var stock: [StockRow] = []
    var purchaseNeeds: [PurchaseNeed] = []
    var purchaseMatrix: [PurchaseMatrixGroup] = []
    var supplierPurchaseOrders: [SupplierPurchaseOrder] = []
    var supplierPurchaseOrderMessage: String?
    var isSupplierPurchaseActionRunning = false
    var mappingWorkbench: MappingWorkbench?
    var orderPickingLists: [String: OrderPickingList] = [:]
    var influencers: [InfluencerProfile] = []
    var influencerSummary: InfluencerSummary?
    var isInfluencerActionRunning = false

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

    func scanStockReceipt(rawText: String, photo: Data?) async throws -> StockReceipt {
        guard let client = apiClient else { throw APIClientError.invalidURL }
        syncError = nil
        do {
            return try await client.scanStockReceipt(rawText: rawText, photo: photo)
        } catch {
            syncError = "No se pudo leer el albaran: \(error.localizedDescription)"
            throw error
        }
    }

    func confirmStockReceipt(_ receipt: StockReceipt, lines: [StockReceiptConfirmLine]) async throws {
        guard let client = apiClient else { throw APIClientError.invalidURL }
        syncError = nil
        do {
            _ = try await client.confirmStockReceipt(id: receipt.id, lines: lines)
            try await loadSnapshot(from: client)
        } catch {
            syncError = "No se pudo confirmar la entrada de stock: \(error.localizedDescription)"
            throw error
        }
    }

    func loadSupplierPurchaseOrders() async {
        guard let client = apiClient else { return }
        do {
            supplierPurchaseOrders = try await client.supplierPurchaseOrders()
        } catch {
            syncError = "No se pudieron cargar compras proveedor: \(error.localizedDescription)"
        }
    }

    func loadInfluencers(stage: String? = nil, query: String? = nil) async {
        guard let client = apiClient else { return }
        do {
            async let summary = client.influencerSummary()
            async let rows = client.influencers(stage: stage, query: query)
            influencerSummary = try await summary
            influencers = try await rows
            isAPIConnected = true
            lastSyncText = Date().formatted(.dateTime.hour().minute().second())
        } catch {
            syncError = "No se pudieron cargar influs: \(error.localizedDescription)"
        }
    }

    func importInfluencerConversations() async throws -> InfluencerImportResult {
        guard let client = apiClient else { throw APIClientError.invalidURL }
        isInfluencerActionRunning = true
        syncError = nil
        defer { isInfluencerActionRunning = false }
        do {
            let result = try await client.importInfluencerConversations(limit: 50)
            await loadInfluencers()
            return result
        } catch {
            syncError = "No se pudieron buscar DMs: \(error.localizedDescription)"
            throw error
        }
    }

    func createInfluencer(handle: String, name: String, notes: String) async {
        guard let client = apiClient else { return }
        isInfluencerActionRunning = true
        syncError = nil
        defer { isInfluencerActionRunning = false }
        do {
            _ = try await client.createInfluencer(InfluencerSaveRequest(
                igHandle: handle,
                fullName: name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : name,
                followers: nil,
                email: nil,
                stage: "PROSPECT",
                tags: nil,
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes
            ))
            await loadInfluencers()
        } catch {
            syncError = "No se pudo crear influ: \(error.localizedDescription)"
        }
    }

    func updateInfluencerStage(_ influencer: InfluencerProfile, stage: String) async {
        guard let client = apiClient else { return }
        isInfluencerActionRunning = true
        syncError = nil
        defer { isInfluencerActionRunning = false }
        do {
            _ = try await client.updateInfluencer(id: influencer.id, body: InfluencerUpdateRequest(stage: stage))
            await loadInfluencers()
        } catch {
            syncError = "No se pudo actualizar influ: \(error.localizedDescription)"
        }
    }

    func refreshSupplierPurchaseRecommendation() async {
        guard let client = apiClient else { return }
        do {
            _ = try await client.generateDailySupplierPurchaseOrder(submit: false)
            supplierPurchaseOrders = try await client.supplierPurchaseOrders()
        } catch {
            syncError = "No se pudo actualizar compra proveedor: \(error.localizedDescription)"
        }
    }

    func generateSupplierPurchaseOrder() async {
        guard let client = apiClient else { return }
        isSupplierPurchaseActionRunning = true
        supplierPurchaseOrderMessage = nil
        syncError = nil
        defer { isSupplierPurchaseActionRunning = false }
        do {
            let response = try await client.generateDailySupplierPurchaseOrder(submit: false)
            supplierPurchaseOrderMessage = supplierPurchaseOrderStatusText(response.status)
            supplierPurchaseOrders = try await client.supplierPurchaseOrders()
        } catch {
            syncError = "No se pudo crear compra proveedor: \(error.localizedDescription)"
        }
    }

    func submitSupplierPurchaseOrder(_ order: SupplierPurchaseOrder) async {
        guard let client = apiClient else { return }
        isSupplierPurchaseActionRunning = true
        supplierPurchaseOrderMessage = nil
        syncError = nil
        defer { isSupplierPurchaseActionRunning = false }
        do {
            let response = try await client.submitSupplierPurchaseOrder(id: order.id)
            supplierPurchaseOrderMessage = supplierPurchaseOrderStatusText(response.status)
            supplierPurchaseOrders = try await client.supplierPurchaseOrders()
        } catch {
            syncError = "No se pudo enviar compra proveedor: \(error.localizedDescription)"
        }
    }

    private func supplierPurchaseOrderStatusText(_ status: String) -> String {
        switch status {
        case "created": "Borrador Falk & Ross creado"
        case "already_exists": "Ya existe un borrador abierto para hoy"
        case "submitted": "Pedido enviado a Falk & Ross"
        case "draft": "Pedido guardado como borrador"
        case "empty": "No hay prendas para pedir"
        default: status
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

    func confirmPickingRemote(_ order: WorkshopOrder) async {
        guard let index = orders.firstIndex(where: { $0.id == order.id }) else { return }
        orders[index].status = .inProduction
        guard let client = apiClient else { return }
        do {
            let updated = try await client.confirmOrderPicking(id: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = updated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo confirmar la cogida de stock: \(error.localizedDescription)"
            await syncFromAPI()
        }
    }

    func confirmPickingBatchRemote(_ batchOrders: [WorkshopOrder]) async {
        guard let client = apiClient, !batchOrders.isEmpty else { return }
        isBatchProcessing = true
        syncError = nil
        defer {
            isBatchProcessing = false
            batchProgressText = nil
        }

        var failures: [String] = []
        for (offset, order) in batchOrders.enumerated() {
            batchProgressText = "Cogiendo stock \(offset + 1)/\(batchOrders.count)"
            do {
                let updated = try await client.confirmOrderPicking(id: order.remoteID ?? order.number)
                if let index = orders.firstIndex(where: { $0.id == order.id }) {
                    orders[index] = updated
                }
            } catch {
                failures.append(order.number)
            }
        }
        await syncFromAPI()
        if !failures.isEmpty {
            syncError = "No se pudo coger stock en lote para: \(failures.joined(separator: ", "))"
        }
    }

    func finishBatchRemote(_ batchOrders: [WorkshopOrder]) async {
        guard let client = apiClient, !batchOrders.isEmpty else { return }
        isBatchProcessing = true
        syncError = nil
        defer {
            isBatchProcessing = false
            batchProgressText = nil
        }

        var failures: [String] = []
        for (offset, order) in batchOrders.enumerated() {
            batchProgressText = "Finalizando \(offset + 1)/\(batchOrders.count)"
            do {
                let updated = try await client.markOrderPrepared(id: order.remoteID ?? order.number)
                if let index = orders.firstIndex(where: { $0.id == order.id }) {
                    orders[index] = updated
                }
            } catch {
                failures.append(order.number)
            }
        }
        await syncFromAPI()
        if !failures.isEmpty {
            syncError = "No se pudo finalizar en lote: \(failures.joined(separator: ", "))"
        }
    }

    func printLabelsBatchRemote(for batchOrders: [WorkshopOrder]) async {
        guard let client = apiClient, !batchOrders.isEmpty else { return }
        isBatchProcessing = true
        syncError = nil
        defer {
            isBatchProcessing = false
            batchProgressText = nil
        }

        var failures: [String] = []
        for (offset, order) in batchOrders.enumerated() {
            batchProgressText = "Enviando a impresora \(offset + 1)/\(batchOrders.count)"
            do {
                if order.status == .readyForLabel && order.printStatus == .none {
                    _ = try await client.createLabel(orderId: order.remoteID ?? order.number)
                } else {
                    try await client.reprintLabelByOrder(orderId: order.remoteID ?? order.number)
                }
            } catch {
                failures.append(order.number)
            }
        }
        await syncFromAPI()
        if !failures.isEmpty {
            syncError = "No se pudo mandar a imprimir: \(failures.joined(separator: ", "))"
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
            DTFView()
                .tabItem { Label("DTF", systemImage: "photo.on.rectangle.angled") }
            PurchaseMatrixView()
                .tabItem { Label("Compras", systemImage: "cart.badge.plus") }
            FinalizedView()
                .tabItem { Label("Finalizados", systemImage: "checkmark.seal.fill") }
            ManualPrintView()
                .tabItem { Label("Imprimir", systemImage: "printer.fill") }
            EconomicsView()
                .tabItem { Label("Economía", systemImage: "eurosign.circle.fill") }
            MetaAdsView()
                .tabItem { Label("Meta Ads", systemImage: "megaphone.fill") }
            InfluencersView()
                .tabItem { Label("Influs", systemImage: "person.2.crop.square.stack.fill") }
            CashflowView()
                .tabItem { Label("Caja", systemImage: "banknote.fill") }
            DevolucionesView()
                .tabItem { Label("Devoluciones", systemImage: "arrow.uturn.left.circle.fill") }
            BankView()
                .tabItem { Label("Banco", systemImage: "building.columns.fill") }
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
                    Task {
                        await store.syncFromAPI()
                        await store.refreshSupplierPurchaseRecommendation()
                    }
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
    @State private var batchMode = false
    @State private var selectedOrderIDs: Set<UUID> = []
    @State private var showingBatchSheet = false

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

    var selectedOrders: [WorkshopOrder] {
        filteredOrders.filter { selectedOrderIDs.contains($0.id) }
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

                    if batchMode {
                        BatchSelectionSummary(
                            count: selectedOrders.count,
                            isProcessing: store.isBatchProcessing,
                            progressText: store.batchProgressText,
                            primaryTitle: "Abrir lote",
                            primaryIcon: "square.stack.3d.up.fill",
                            onPrimary: { showingBatchSheet = true },
                            onSelectAll: { selectedOrderIDs = Set(filteredOrders.map(\.id)) },
                            onClear: { selectedOrderIDs.removeAll() }
                        )
                    }

                    if filteredOrders.isEmpty {
                        ContentUnavailableView("Nada pendiente", systemImage: "checkmark.circle.fill", description: Text("No hay pedidos con estos filtros."))
                            .glassPanel()
                    } else {
                        LazyVStack(spacing: 12) {
                            ForEach(filteredOrders) { order in
                                if batchMode {
                                    Button {
                                        toggleSelection(order)
                                    } label: {
                                        SelectableOrderCard(isSelected: selectedOrderIDs.contains(order.id)) {
                                            PendingOrderRow(order: order, showsAction: false) {}
                                        }
                                        .glassPanel(padding: 14, accent: selectedOrderIDs.contains(order.id) ? AppTheme.blue : order.priority.color)
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    NavigationLink(value: order) {
                                        PendingOrderRow(order: order, showsAction: false) {}
                                            .glassPanel(padding: 14, accent: order.priority.color)
                                    }
                                    .buttonStyle(.plain)
                                }
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
                ToolbarItem(placement: .topBarLeading) {
                    Button(batchMode ? "Cerrar lote" : "Lote") {
                        batchMode.toggle()
                        if !batchMode { selectedOrderIDs.removeAll() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        FulfillableOrdersView()
                    } label: {
                        Image(systemName: "checklist")
                    }
                }
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
            .sheet(isPresented: $showingBatchSheet) {
                NavigationStack {
                    BatchPreparationView(orders: selectedOrders) {
                        showingBatchSheet = false
                        selectedOrderIDs.removeAll()
                        batchMode = false
                    }
                }
            }
        }
    }

    private func toggleSelection(_ order: WorkshopOrder) {
        if selectedOrderIDs.contains(order.id) {
            selectedOrderIDs.remove(order.id)
        } else {
            selectedOrderIDs.insert(order.id)
        }
    }
}

struct BatchPreparationView: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let orders: [WorkshopOrder]
    let onDone: () -> Void

    var currentOrders: [WorkshopOrder] {
        orders.map { order in
            store.orders.first(where: { $0.id == order.id }) ?? order
        }
    }

    var ordersToPick: [WorkshopOrder] {
        currentOrders.filter { !$0.status.stockAlreadyPicked && $0.status != .waitingStock }
    }

    var ordersToFinish: [WorkshopOrder] {
        currentOrders.filter { $0.status.stockAlreadyPicked && $0.status != .readyForLabel && $0.status != .labelCreated && $0.status != .shipped }
    }

    var aggregateLines: [BatchPickLine] {
        var grouped: [String: BatchPickLine] = [:]
        for order in currentOrders {
            let key = order.remoteID ?? order.number
            guard let list = store.orderPickingLists[key] else { continue }
            for line in list.lines {
                var current = grouped[line.key] ?? BatchPickLine(
                    key: line.key,
                    title: line.subproductName,
                    color: line.color,
                    size: line.size,
                    quantity: 0,
                    stockAvailable: line.stockAvailable,
                    orderNumbers: []
                )
                current.quantity += line.quantity
                current.stockAvailable = min(current.stockAvailable, line.stockAvailable)
                current.orderNumbers.append(order.number)
                grouped[line.key] = current
            }
        }
        return grouped.values.sorted {
            if $0.title == $1.title { return $0.size < $1.size }
            return $0.title < $1.title
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Lote de taller")
                        .font(.system(size: 34, weight: .black))
                        .foregroundStyle(AppTheme.ink)
                    Text("\(currentOrders.count) pedidos seleccionados")
                        .font(.headline)
                        .foregroundStyle(AppTheme.muted)
                    Text("Primero coge prendas del lote. Cuando esten fabricadas, finaliza el lote y pasara a Envios.")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.muted)
                }
                .glassPanel(accent: AppTheme.blue)

                if store.isBatchProcessing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text(store.batchProgressText ?? "Procesando lote...")
                            .font(.headline.weight(.bold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassPanel(accent: AppTheme.amber)
                }

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                    MetricTile(title: "Pedidos", value: currentOrders.count, color: AppTheme.blue, icon: "shippingbox.fill")
                    MetricTile(title: "Por coger", value: ordersToPick.count, color: AppTheme.amber, icon: "tshirt.fill")
                    MetricTile(title: "Fabricar", value: ordersToFinish.count, color: AppTheme.green, icon: "hammer.fill")
                }

                SectionHeader(title: "Coger del stock", subtitle: "Suma de prendas base para todos los pedidos seleccionados")

                if aggregateLines.isEmpty {
                    ContentUnavailableView("Sin prendas calculadas", systemImage: "shippingbox", description: Text("Abre este lote cuando los pedidos tengan mapeos cargados."))
                        .glassPanel()
                } else {
                    ForEach(aggregateLines) { line in
                        BatchPickLineCard(line: line)
                    }
                }

                VStack(spacing: 10) {
                    Button {
                        Task {
                            await store.confirmPickingBatchRemote(ordersToPick)
                        }
                    } label: {
                        Label("He cogido todo el stock del lote", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.blue)
                    .controlSize(.large)
                    .disabled(ordersToPick.isEmpty || store.isBatchProcessing)

                    Button {
                        Task {
                            await store.finishBatchRemote(ordersToFinish)
                            onDone()
                        }
                    } label: {
                        Label("Finalizar lote y mandar a Envios", systemImage: "arrow.right.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.green)
                    .controlSize(.large)
                    .disabled(ordersToFinish.isEmpty || store.isBatchProcessing)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Lote")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cerrar") { dismiss() }
            }
        }
        .task {
            for order in currentOrders {
                await store.loadPickingList(for: order)
            }
        }
    }
}

struct BatchPickLine: Identifiable {
    let key: String
    var id: String { key }
    let title: String
    let color: String
    let size: String
    var quantity: Int
    var stockAvailable: Int
    var orderNumbers: [String]
}

struct BatchPickLineCard: View {
    let line: BatchPickLine

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(line.title)
                        .font(.title3.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    Text(line.orderNumbers.uniqued().joined(separator: ", "))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                }
                Spacer()
                Text("x\(line.quantity)")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                    .foregroundStyle(AppTheme.blue)
            }
            FlowChips {
                Tag(text: line.color, systemImage: "paintpalette.fill")
                Tag(text: line.size, systemImage: "ruler.fill")
                Tag(text: "Stock: \(line.stockAvailable)", systemImage: "tray.full.fill")
                Tag(text: "Queda: \(line.stockAvailable - line.quantity)", systemImage: "minus.circle.fill")
            }
            if line.quantity > 1 {
                Label("Coge \(line.quantity) unidades de esta talla/color", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
        }
        .glassPanel(accent: line.stockAvailable >= line.quantity ? AppTheme.blue : AppTheme.red)
    }
}

extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

struct SelectableOrderCard<Content: View>: View {
    let isSelected: Bool
    @ViewBuilder var content: Content

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title2.weight(.bold))
                .foregroundStyle(isSelected ? AppTheme.blue : AppTheme.mutedSoft)
                .padding(6)
        }
    }
}

struct BatchSelectionSummary: View {
    let count: Int
    let isProcessing: Bool
    let progressText: String?
    let primaryTitle: String
    let primaryIcon: String
    var isPrimaryDisabled = false
    let onPrimary: () -> Void
    let onSelectAll: () -> Void
    let onClear: () -> Void

    @State private var actionFired = false

    private var blocked: Bool { isPrimaryDisabled || count == 0 || isProcessing || actionFired }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("\(count) seleccionados", systemImage: "checkmark.circle.fill")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                if isProcessing || actionFired {
                    ProgressView()
                }
            }
            if let progressText {
                Text(progressText)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
            HStack(spacing: 8) {
                Button(action: onSelectAll) {
                    Label("Todos", systemImage: "checklist")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                Button(action: onClear) {
                    Label("Limpiar", systemImage: "xmark.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                Button {
                    guard !blocked else { return }
                    actionFired = true
                    onPrimary()
                } label: {
                    Label(primaryTitle, systemImage: primaryIcon)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(blocked)
            }
        }
        .glassPanel(accent: AppTheme.blue)
        .onChange(of: isProcessing) { _, processing in
            if !processing { actionFired = false }
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
    @State private var batchMode = false
    @State private var selectedOrderIDs: Set<UUID> = []

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

    var selectedOrders: [WorkshopOrder] {
        filteredOrders.filter { selectedOrderIDs.contains($0.id) }
    }

    var selectedPrintableOrders: [WorkshopOrder] {
        selectedOrders.filter { $0.status == .readyForLabel || $0.status == .labelCreated }
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

                    if batchMode {
                        BatchSelectionSummary(
                            count: selectedOrders.count,
                            isProcessing: store.isBatchProcessing,
                            progressText: store.batchProgressText,
                            primaryTitle: "Crear e imprimir",
                            primaryIcon: "printer.fill",
                            isPrimaryDisabled: selectedPrintableOrders.isEmpty,
                            onPrimary: {
                                Task {
                                    await store.printLabelsBatchRemote(for: selectedPrintableOrders)
                                    selectedOrderIDs.removeAll()
                                    batchMode = false
                                }
                            },
                            onSelectAll: { selectedOrderIDs = Set(filteredOrders.map(\.id)) },
                            onClear: { selectedOrderIDs.removeAll() }
                        )
                    }

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
                                if batchMode {
                                    Button {
                                        toggleSelection(order)
                                    } label: {
                                        SelectableOrderCard(isSelected: selectedOrderIDs.contains(order.id)) {
                                            ShippingOrderCard(order: order, scanningOrder: $scanningOrder, showsActions: false)
                                        }
                                    }
                                    .buttonStyle(.plain)
                                } else {
                                    ShippingOrderCard(order: order, scanningOrder: $scanningOrder)
                                }
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
                ToolbarItem(placement: .topBarLeading) {
                    Button(batchMode ? "Cerrar lote" : "Lote") {
                        batchMode.toggle()
                        if !batchMode { selectedOrderIDs.removeAll() }
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

    private func toggleSelection(_ order: WorkshopOrder) {
        if selectedOrderIDs.contains(order.id) {
            selectedOrderIDs.remove(order.id)
        } else {
            selectedOrderIDs.insert(order.id)
        }
    }
}

struct ShippingOrderCard: View {
    @Environment(WorkshopStore.self) private var store
    let order: WorkshopOrder
    @Binding var scanningOrder: WorkshopOrder?
    var showsActions = true

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

            if showsActions {
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
    @State private var showingReceiptCamera = false
    @State private var showingReceiptPDF = false
    @State private var receiptReview: StockReceiptReviewState?
    @State private var stockEdit: StockEditSelection?

    var garmentGroups: [PurchaseMatrixGroup] {
        store.purchaseMatrix.filter { $0.garmentType != "DTF" }
    }

    var filteredGroups: [PurchaseMatrixGroup] {
        guard !query.isEmpty else { return garmentGroups }
        return garmentGroups.filter { group in
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
                        Text("Stock real de camisetas y sudaderas. Toca una talla para modificar unidades.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Stock", value: garmentGroups.reduce(0) { $0 + $1.totalStock }, color: AppTheme.green, icon: "archivebox.fill")
                        MetricTile(title: "Con stock", value: garmentGroups.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock > 0 }.count }, color: AppTheme.blue, icon: "checkmark.circle.fill")
                        MetricTile(title: "Sin stock", value: garmentGroups.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock == 0 }.count }, color: AppTheme.amber, icon: "exclamationmark.circle.fill")
                    }

                    VStack(spacing: 10) {
                        TextField("Buscar prenda, color o talla", text: $query)
                            .textFieldStyle(.roundedBorder)
                        HStack(spacing: 10) {
                            Button { showingScanner = true } label: {
                                Label("Escanear QR", systemImage: "barcode.viewfinder")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .tint(AppTheme.blue)

                            Menu {
                                Button {
                                    showingReceiptCamera = true
                                } label: {
                                    Label("Foto / cámara", systemImage: "doc.viewfinder")
                                }
                                Button {
                                    showingReceiptPDF = true
                                } label: {
                                    Label("Subir PDF", systemImage: "doc.fill.badge.plus")
                                }
                            } label: {
                                Label("Albarán", systemImage: "doc.text.viewfinder")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(AppTheme.green)
                        }
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
            .sheet(isPresented: $showingReceiptCamera) {
                PackagePhotoCaptureView(order: WorkshopOrder.placeholderForPhoto) { photo in
                    showingReceiptCamera = false
                    guard let photo else { return }
                    receiptReview = StockReceiptReviewState(photo: photo)
                }
            }
            .fileImporter(
                isPresented: $showingReceiptPDF,
                allowedContentTypes: [.pdf],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    guard let url = urls.first else { return }
                    Task { await importReceiptPDF(url) }
                case .failure(let error):
                    store.syncError = "No se pudo abrir el PDF: \(error.localizedDescription)"
                }
            }
            .sheet(item: $receiptReview) { review in
                StockReceiptReviewView(state: review)
            }
        }
    }

    private func importReceiptPDF(_ url: URL) async {
        do {
            let text = try await extractReceiptText(fromPDF: url)
            await MainActor.run {
                receiptReview = StockReceiptReviewState(pdfText: text, filename: url.lastPathComponent)
            }
        } catch {
            await MainActor.run {
                store.syncError = "No se pudo leer el PDF: \(error.localizedDescription)"
            }
        }
    }
}

struct StockMatrixCard: View {
    let group: PurchaseMatrixGroup
    var onEditStock: (PurchaseMatrixEntry) -> Void

    var body: some View {
        if group.garmentType == "DTF" {
            dtfBody
        } else {
            garmentBody
        }
    }

    private var garmentBody: some View {
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

    private var dtfBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("DTF externo")
                    .font(.headline.weight(.black))
                    .foregroundStyle(group.foregroundColor)
                Spacer()
                Text("\(group.totalStock) en stock")
                    .font(.caption.weight(.black))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .foregroundStyle(group.foregroundColor)
                    .background(Color.white.opacity(0.22))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(group.backgroundColor)

            VStack(spacing: 0) {
                ForEach(group.entries.sorted { $0.subproductName.localizedCaseInsensitiveCompare($1.subproductName) == .orderedAscending }) { entry in
                    Button {
                        onEditStock(entry)
                    } label: {
                        HStack(spacing: 12) {
                            DTFThumbnail(entry: entry, size: 54)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(entry.subproductName)
                                    .font(.subheadline.weight(.black))
                                    .foregroundStyle(AppTheme.ink)
                                    .lineLimit(2)
                                Text("ped \(entry.pendingOrderNeed) · comprar \(entry.recommendedPurchaseQuantity)")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(AppTheme.muted)
                                    .lineLimit(1)
                            }
                            Spacer()
                            Text("\(entry.currentInternalStock)")
                                .font(.system(size: 28, weight: .black))
                                .foregroundStyle(entry.currentInternalStock > 0 ? AppTheme.green : AppTheme.ink)
                                .frame(minWidth: 48)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(AppTheme.surfaceStrong)
                    }
                    .buttonStyle(.plain)
                    .disabled(entry.sku == nil)

                    if entry.id != group.entries.last?.id {
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

struct DTFView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var query = ""
    @State private var stockEdit: StockEditSelection?

    private var dtfGroup: PurchaseMatrixGroup? {
        store.purchaseMatrix.first { $0.garmentType == "DTF" }
    }

    private var dtfEntries: [PurchaseMatrixEntry] {
        let entries = dtfGroup?.entries ?? []
        let filtered = query.isEmpty ? entries : entries.filter {
            $0.subproductName.localizedCaseInsensitiveContains(query) ||
            ($0.sku ?? "").localizedCaseInsensitiveContains(query)
        }
        return filtered.sorted {
            if $0.recommendedPurchaseQuantity == $1.recommendedPurchaseQuantity {
                return $0.subproductName.localizedCaseInsensitiveCompare($1.subproductName) == .orderedAscending
            }
            return $0.recommendedPurchaseQuantity > $1.recommendedPurchaseQuantity
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()

                    VStack(alignment: .leading, spacing: 4) {
                        Text("DTF")
                            .font(.system(size: 38, weight: .black))
                            .foregroundStyle(AppTheme.ink)
                        Text("Diseños externos: stock, pendientes y unidades a pedir.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Pedir", value: dtfGroup?.totalRecommended ?? 0, color: AppTheme.magenta, icon: "cart.badge.plus")
                        MetricTile(title: "Pedidos", value: dtfGroup?.totalPending ?? 0, color: AppTheme.blue, icon: "shippingbox.fill")
                        MetricTile(title: "Stock", value: dtfGroup?.totalStock ?? 0, color: AppTheme.green, icon: "archivebox.fill")
                    }

                    TextField("Buscar diseño DTF", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .glassPanel(padding: 12)

                    if dtfEntries.isEmpty {
                        ContentUnavailableView("Sin DTF", systemImage: "photo.on.rectangle.angled", description: Text("No hay diseños DTF que coincidan con la busqueda."))
                            .glassPanel()
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 14)], spacing: 14) {
                            ForEach(dtfEntries) { entry in
                                DTFDesignCard(entry: entry) {
                                    guard let group = dtfGroup, let sku = entry.sku else { return }
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
            .navigationTitle("DTF")
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
            .sheet(item: $stockEdit) { edit in
                StockEditSheet(selection: edit) { quantity in
                    stockEdit = nil
                    Task { await store.setStockQuantity(sku: edit.sku, quantity: quantity) }
                }
            }
        }
    }
}

struct DTFDesignCard: View {
    let entry: PurchaseMatrixEntry
    let onEditStock: () -> Void

    var body: some View {
        Button(action: onEditStock) {
            HStack(spacing: 12) {
                DTFThumbnail(entry: entry, size: 74)
                VStack(alignment: .leading, spacing: 8) {
                    Text(entry.subproductName.replacingOccurrences(of: "DTF ", with: ""))
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        MiniMetric(label: "ped", value: entry.pendingOrderNeed, color: AppTheme.blue)
                        MiniMetric(label: "stk", value: entry.currentInternalStock, color: AppTheme.green)
                    }
                    if entry.recommendedPurchaseQuantity > 0 {
                        Label("Pedir \(entry.recommendedPurchaseQuantity)", systemImage: "cart.badge.plus")
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppTheme.magenta)
                    }
                }
                Spacer()
                Text("\(entry.currentInternalStock)")
                    .font(.system(size: 34, weight: .black))
                    .foregroundStyle(entry.currentInternalStock > 0 ? AppTheme.green : AppTheme.ink)
                    .frame(minWidth: 48)
            }
            .padding(12)
            .background(AppTheme.surfaceStrong)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(entry.recommendedPurchaseQuantity > 0 ? AppTheme.magenta.opacity(0.38) : AppTheme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .disabled(entry.sku == nil)
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

struct StockReceiptReviewState: Identifiable {
    let id = UUID()
    let photo: Data?
    let rawText: String?
    let filename: String?

    init(photo: Data) {
        self.photo = photo
        self.rawText = nil
        self.filename = nil
    }

    init(pdfText: String, filename: String) {
        self.photo = nil
        self.rawText = pdfText
        self.filename = filename
    }

    func readableText() async throws -> String {
        if let rawText {
            let clean = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
            if clean.isEmpty {
                throw APIClientError.server(422, "No se ha podido leer texto en el PDF.")
            }
            return clean
        }
        guard let photo else { throw APIClientError.invalidResponse }
        return try await recognizeReceiptText(from: photo)
    }
}

struct EditableReceiptLine: Identifiable, Hashable {
    let id: String
    let stockItemId: String?
    let detectedName: String
    let matchedName: String
    let sku: String?
    let rawLine: String?
    var quantityText: String

    init(line: StockReceiptLine) {
        id = line.id
        stockItemId = line.stockItemId
        detectedName = line.detectedName
        matchedName = line.matchedName ?? line.detectedName
        sku = line.sku
        rawLine = line.rawLine
        quantityText = "\(line.quantity)"
    }

    var quantity: Int { max(0, Int(quantityText) ?? 0) }
}

struct StockReceiptReviewView: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let state: StockReceiptReviewState
    @State private var rawText = ""
    @State private var receipt: StockReceipt?
    @State private var lines: [EditableReceiptLine] = []
    @State private var isReading = true
    @State private var isConfirming = false
    @State private var error: String?

    var validLines: [EditableReceiptLine] {
        lines.filter { $0.stockItemId != nil && $0.quantity > 0 }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let photo = state.photo, let image = UIImage(data: photo) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 260)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .glassPanel(padding: 0)
                    } else if let filename = state.filename {
                        Label(filename, systemImage: "doc.richtext.fill")
                            .font(.headline.weight(.black))
                            .foregroundStyle(AppTheme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassPanel(padding: 16, accent: AppTheme.green)
                    }

                    if isReading {
                        VStack(spacing: 10) {
                            ProgressView()
                            Text("Leyendo albaran...")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(AppTheme.muted)
                        }
                        .frame(maxWidth: .infinity)
                        .glassPanel()
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Revisa antes de sumar stock")
                                .font(.title2.weight(.black))
                                .foregroundStyle(AppTheme.ink)
                            Text("La app propone las prendas detectadas. Cambia cantidades si hace falta y confirma.")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(AppTheme.muted)
                        }

                        if lines.isEmpty {
                            ContentUnavailableView(
                                "No he encontrado prendas",
                                systemImage: "doc.text.magnifyingglass",
                                description: Text("Prueba con una foto mas recta, o mete el stock a mano desde la pantalla Stock.")
                            )
                            .glassPanel()
                        } else {
                            ForEach($lines) { $line in
                                StockReceiptLineEditor(line: $line)
                            }
                        }

                        if !rawText.isEmpty {
                            DisclosureGroup("Texto leido del albaran") {
                                Text(rawText)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(AppTheme.muted)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 8)
                            }
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AppTheme.ink)
                            .glassPanel(padding: 14)
                        }
                    }

                    if let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.red)
                            .glassPanel(padding: 12, accent: AppTheme.red)
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Recibir albaran")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isConfirming ? "Guardando..." : "Confirmar") {
                        Task { await confirm() }
                    }
                    .disabled(isReading || isConfirming || receipt == nil || validLines.isEmpty)
                    .tint(AppTheme.green)
                }
            }
            .task { await readReceipt() }
        }
    }

    private func readReceipt() async {
        guard rawText.isEmpty, receipt == nil else { return }
        isReading = true
        error = nil
        defer { isReading = false }
        do {
            let text = try await state.readableText()
            rawText = text
            let draft = try await store.scanStockReceipt(rawText: text, photo: state.photo)
            receipt = draft
            lines = draft.lines.map(EditableReceiptLine.init)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func confirm() async {
        guard let receipt else { return }
        isConfirming = true
        error = nil
        defer { isConfirming = false }
        do {
            let payload = validLines.map {
                StockReceiptConfirmLine(id: $0.id, stockItemId: $0.stockItemId, quantity: $0.quantity, detectedName: $0.detectedName)
            }
            try await store.confirmStockReceipt(receipt, lines: payload)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct StockReceiptLineEditor: View {
    @Binding var line: EditableReceiptLine

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(line.matchedName)
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    if let sku = line.sku {
                        Text(sku)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                Spacer()
                TextField("0", text: $line.quantityText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 28, weight: .black, design: .rounded))
                    .frame(width: 72)
                    .padding(.vertical, 8)
                    .background(AppTheme.surfaceStrong)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            if let rawLine = line.rawLine, rawLine != line.matchedName {
                Text(rawLine)
                    .font(.caption2)
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
            }
            Stepper("Unidades: \(line.quantity)", value: Binding(
                get: { line.quantity },
                set: { line.quantityText = "\($0)" }
            ), in: 0...999)
            .font(.caption.weight(.bold))
            .foregroundStyle(AppTheme.muted)
        }
        .glassPanel(padding: 14, accent: line.stockItemId == nil ? AppTheme.amber : AppTheme.green)
    }
}

func recognizeReceiptText(from imageData: Data) async throws -> String {
    guard let image = UIImage(data: imageData), let cgImage = image.cgImage else {
        throw APIClientError.invalidResponse
    }
    return try await withCheckedThrowingContinuation { continuation in
        let request = VNRecognizeTextRequest { request, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            let text = (request.results as? [VNRecognizedTextObservation])?
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n") ?? ""
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                continuation.resume(throwing: APIClientError.server(422, "No se ha podido leer texto en la foto."))
            } else {
                continuation.resume(returning: text)
            }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["es-ES", "en-US"]
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: .up).perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}

func extractReceiptText(fromPDF url: URL) async throws -> String {
    let didAccess = url.startAccessingSecurityScopedResource()
    defer {
        if didAccess { url.stopAccessingSecurityScopedResource() }
    }

    guard let document = PDFDocument(url: url) else {
        throw APIClientError.invalidResponse
    }

    let embeddedText = (0..<document.pageCount)
        .compactMap { document.page(at: $0)?.string }
        .joined(separator: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)

    if !embeddedText.isEmpty {
        return embeddedText
    }

    let renderedPages = (0..<document.pageCount)
        .compactMap { document.page(at: $0) }
        .compactMap { renderPDFPageForOCR($0) }

    var ocrText: [String] = []
    for imageData in renderedPages {
        if let text = try? await recognizeReceiptText(from: imageData), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ocrText.append(text)
        }
    }

    let text = ocrText.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty {
        throw APIClientError.server(422, "No se ha podido leer texto del PDF escaneado.")
    }
    return text
}

func renderPDFPageForOCR(_ page: PDFPage) -> Data? {
    let bounds = page.bounds(for: .mediaBox)
    guard bounds.width > 0, bounds.height > 0 else { return nil }

    let scale: CGFloat = 2.4
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true

    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        context.cgContext.saveGState()
        context.cgContext.translateBy(x: 0, y: size.height)
        context.cgContext.scaleBy(x: scale, y: -scale)
        page.draw(with: .mediaBox, to: context.cgContext)
        context.cgContext.restoreGState()
    }

    return image.jpegData(compressionQuality: 0.92)
}

extension FulfillableOrder: Hashable {
    static func == (lhs: FulfillableOrder, rhs: FulfillableOrder) -> Bool { lhs.orderId == rhs.orderId }
    func hash(into hasher: inout Hasher) { hasher.combine(orderId) }
}

struct FulfillableOrderDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let order: FulfillableOrder

    private var badgeColor: Color {
        switch order.fulfillability {
        case .full: AppTheme.green
        case .partial: AppTheme.amber
        case .none: AppTheme.red
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.orderNumber)
                        .font(.system(size: 30, weight: .black, design: .rounded))
                        .foregroundStyle(AppTheme.ink)
                    Text(order.customer)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }
                .glassPanel(padding: 16)

                SectionHeader(title: "Contenido del pedido", subtitle: "\(order.items.reduce(0) { $0 + $1.quantity }) artículos")
                VStack(spacing: 8) {
                    ForEach(order.items) { item in
                        HStack(spacing: 10) {
                            if let url = item.imageUrl.flatMap({ URL(string: $0) }) {
                                AsyncImage(url: url) { phase in
                                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                                    else { Color.clear }
                                }
                                .frame(width: 52, height: 52)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            } else {
                                RoundedRectangle(cornerRadius: 8).fill(AppTheme.surfaceSoft)
                                    .frame(width: 52, height: 52)
                                    .overlay(Image(systemName: "tshirt.fill").foregroundStyle(AppTheme.mutedSoft))
                            }
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(AppTheme.ink).lineLimit(2)
                                HStack(spacing: 6) {
                                    if let color = item.color, !color.isEmpty {
                                        Text(color).font(.caption).foregroundStyle(AppTheme.muted)
                                    }
                                    if let size = item.size, !size.isEmpty {
                                        Text(size).font(.caption.weight(.black)).foregroundStyle(AppTheme.teal)
                                    } else if let variant = item.variantTitle, !variant.isEmpty {
                                        Text(variant).font(.caption).foregroundStyle(AppTheme.muted)
                                    }
                                }
                            }
                            Spacer()
                            Text("×\(item.quantity)")
                                .font(.title3.weight(.black))
                                .foregroundStyle(AppTheme.ink)
                        }
                        .padding(10)
                        .glassPanel(padding: 0)
                    }
                }

                SectionHeader(title: "Stock necesario", subtitle: "Prendas base a coger del almacén")
                VStack(spacing: 6) {
                    ForEach(order.lines, id: \.key) { line in
                        HStack(spacing: 8) {
                            Circle().fill(line.canFulfill ? AppTheme.green : AppTheme.red)
                                .frame(width: 8, height: 8)
                            Text(line.subproductName)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AppTheme.ink).lineLimit(1)
                            Text(line.size)
                                .font(.caption.weight(.black)).foregroundStyle(AppTheme.teal)
                            Spacer()
                            Text("Necesita \(line.required)")
                                .font(.caption2).foregroundStyle(AppTheme.muted)
                            Text("·").foregroundStyle(AppTheme.line)
                            Text("Stock \(line.available)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(line.canFulfill ? AppTheme.green : AppTheme.red)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .glassPanel(padding: 0, accent: line.canFulfill ? AppTheme.green.opacity(0.15) : AppTheme.red.opacity(0.1))
                    }
                }

                let workshopOrder = store.orders.first { $0.number == order.orderNumber || $0.remoteID == order.orderId }
                if let wo = workshopOrder {
                    NavigationLink(value: wo) {
                        Label("Preparar pedido", systemImage: "tshirt.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(badgeColor)
                    .controlSize(.large)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle(order.orderNumber)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: WorkshopOrder.self) { wo in
            OrderPreparationDetailView(order: wo)
        }
    }
}

struct FulfillableOrdersView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var response: FulfillableOrdersResponse?
    @State private var loading = false
    @State private var error: String?
    @State private var filter: Fulfillability? = nil

    private var filtered: [FulfillableOrder] {
        guard let orders = response?.orders else { return [] }
        guard let f = filter else { return orders }
        return orders.filter { $0.fulfillability == f }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("¿Qué puedo hacer?")
                        .font(.system(size: 34, weight: .black))
                        .foregroundStyle(AppTheme.ink)
                    Text("Pedidos que el stock actual puede cubrir.")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }

                if let summary = response?.summary {
                    HStack(spacing: 10) {
                        FulfillChip(label: "Completos", count: summary.full, color: AppTheme.green)
                        FulfillChip(label: "Parciales", count: summary.partial, color: AppTheme.amber)
                        FulfillChip(label: "Sin stock", count: summary.none, color: AppTheme.red)
                    }
                    .glassPanel(padding: 12)
                }

                HStack(spacing: 8) {
                    FilterChip(label: "Todos", active: filter == nil) { filter = nil }
                    FilterChip(label: "Completos", active: filter == .full) { filter = filter == .full ? nil : .full }
                    FilterChip(label: "Parciales", active: filter == .partial) { filter = filter == .partial ? nil : .partial }
                    FilterChip(label: "Sin stock", active: filter == .none) { filter = filter == .none ? nil : .none }
                }

                if loading && response == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                } else if filtered.isEmpty {
                    ContentUnavailableView("Sin resultados", systemImage: "tray", description: Text("No hay pedidos con ese filtro."))
                        .glassPanel()
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(filtered) { order in
                            NavigationLink(value: order) {
                                FulfillableOrderRow(order: order)
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
        .navigationTitle("Stock disponible")
        .navigationDestination(for: FulfillableOrder.self) { order in
            FulfillableOrderDetailView(order: order)
        }
        .toolbar {
            Button { Task { await load() } } label: {
                Image(systemName: "arrow.clockwise")
            }.disabled(loading)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = store.apiClient else { return }
        loading = true; defer { loading = false }
        error = nil
        do { response = try await client.fulfillableOrders() }
        catch let err { error = err.localizedDescription }
    }
}

struct FulfillChip: View {
    let label: String
    let count: Int
    let color: Color
    var body: some View {
        VStack(spacing: 2) {
            Text("\(count)")
                .font(.system(size: 22, weight: .black))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity)
    }
}

struct FilterChip: View {
    let label: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(active ? AppTheme.teal.opacity(0.18) : AppTheme.surfaceSoft)
                .foregroundStyle(active ? AppTheme.teal : AppTheme.muted)
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(active ? AppTheme.teal.opacity(0.4) : AppTheme.line))
                .clipShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
    }
}

struct FulfillableOrderRow: View {
    let order: FulfillableOrder

    private var badgeColor: Color {
        switch order.fulfillability {
        case .full: AppTheme.green
        case .partial: AppTheme.amber
        case .none: AppTheme.red
        }
    }
    private var badgeLabel: String {
        switch order.fulfillability {
        case .full: "COMPLETO"
        case .partial: "PARCIAL"
        case .none: "SIN STOCK"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(order.orderNumber)
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text(order.customer)
                        .font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 3) {
                    Text(badgeLabel)
                        .font(.caption2.weight(.black))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(badgeColor.opacity(0.18))
                        .foregroundStyle(badgeColor)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(badgeColor.opacity(0.3)))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text("\(order.fulfillableItems)/\(order.totalItems) uds")
                        .font(.caption2).foregroundStyle(AppTheme.muted)
                }
                Image(systemName: "chevron.right")
                    .font(.caption2).foregroundStyle(AppTheme.muted)
            }
            .padding(12)

            if !order.lines.isEmpty {
                Divider().background(AppTheme.line).padding(.horizontal, 12)
                VStack(spacing: 6) {
                    ForEach(order.lines, id: \.key) { line in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(line.canFulfill ? AppTheme.green : AppTheme.red)
                                .frame(width: 7, height: 7)
                            Text(line.subproductName)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppTheme.ink)
                                .lineLimit(1)
                            Text(line.size)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(AppTheme.teal)
                            Spacer()
                            Text("Necesita \(line.required)")
                                .font(.caption2).foregroundStyle(AppTheme.muted)
                            Text("·")
                                .foregroundStyle(AppTheme.line)
                            Text("Stock \(line.available)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(line.canFulfill ? AppTheme.green : AppTheme.red)
                        }
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
            }
        }
        .glassPanel(padding: 0, accent: badgeColor.opacity(0.2))
    }
}

struct PurchaseMatrixView: View {
    @Environment(WorkshopStore.self) private var store

    private var garmentGroups: [PurchaseMatrixGroup] {
        store.purchaseMatrix.filter { $0.garmentType != "DTF" }
    }

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
                        MetricTile(title: "Comprar", value: garmentGroups.reduce(0) { $0 + $1.totalRecommended }, color: AppTheme.magenta, icon: "cart.badge.plus")
                        MetricTile(title: "Pedidos", value: garmentGroups.reduce(0) { $0 + $1.totalPending }, color: AppTheme.blue, icon: "shippingbox.fill")
                        MetricTile(title: "Stock", value: garmentGroups.reduce(0) { $0 + $1.totalStock }, color: AppTheme.green, icon: "archivebox.fill")
                    }

                    SupplierPurchaseOrderCard()

                    let groups = garmentGroups.filter { $0.totalRecommended > 0 }

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
                await store.refreshSupplierPurchaseRecommendation()
            }
            .task {
                await store.refreshSupplierPurchaseRecommendation()
            }
        }
    }
}

struct SupplierPurchaseOrderCard: View {
    @Environment(WorkshopStore.self) private var store
    @State private var orderPendingSubmit: SupplierPurchaseOrder?
    @State private var showSubmitConfirmation = false
    @State private var selectedSummaryDate = Date()

    private var latestOrder: SupplierPurchaseOrder? {
        store.supplierPurchaseOrders.first
    }

    private var ordersForSelectedDay: [SupplierPurchaseOrder] {
        store.supplierPurchaseOrders.filter { order in
            guard let date = order.submittedAt ?? order.createdAt ?? order.orderDate else { return false }
            return Calendar.current.isDate(date, inSameDayAs: selectedSummaryDate)
        }
    }

    private var submittedOrdersForSelectedDay: [SupplierPurchaseOrder] {
        ordersForSelectedDay.filter { $0.status.uppercased() == "SUBMITTED" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "building.2.crop.circle.fill")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(AppTheme.blue)
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Compras proveedor")
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    Text("Revisa, envia a Falk & Ross y consulta el historico diario.")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                }

                Spacer()

                if let latestOrder {
                    SupplierPurchaseStatusBadge(status: latestOrder.status)
                }
            }

            if let message = store.supplierPurchaseOrderMessage {
                Label(message, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.green)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(AppTheme.green.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            if let latestOrder {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(latestOrder.orderNumber)
                                .font(.title3.weight(.black))
                                .foregroundStyle(AppTheme.ink)
                            Text("\(latestOrder.lines.count) lineas · \(latestOrder.totalQuantity) prendas")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AppTheme.muted)
                        }
                        Spacer()
                        if let externalOrderId = latestOrder.externalOrderId, !externalOrderId.isEmpty {
                            Tag(text: externalOrderId, systemImage: "checkmark.seal.fill")
                        }
                    }

                    if let orderNote = latestOrder.orderNote, !orderNote.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Label("Comentario para Falk & Ross", systemImage: "text.quote")
                                .font(.caption.weight(.black))
                                .foregroundStyle(AppTheme.amber)
                            Text(orderNote)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppTheme.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(AppTheme.amber.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Compra recomendada")
                                .font(.caption.weight(.black))
                                .foregroundStyle(AppTheme.muted)
                            Spacer()
                            Text("\(latestOrder.lines.count) lineas")
                                .font(.caption2.weight(.black))
                                .foregroundStyle(AppTheme.muted)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(AppTheme.surface)
                                .clipShape(Capsule())
                        }

                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(latestOrder.lines) { line in
                                    SupplierPurchaseLineRow(line: line)
                                }
                            }
                        }
                        .frame(maxHeight: 320)
                        .scrollIndicators(.visible)
                    }

                    if let error = latestOrder.errorMessage, !error.isEmpty {
                        Text(error)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.red)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(AppTheme.red.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(12)
                .background(AppTheme.surfaceSoft)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            } else {
                EmptyStateCard(title: "Sin borrador proveedor", subtitle: "Crea la recomendacion del dia cuando quieras revisar la compra.")
            }

            HStack(spacing: 10) {
                Button {
                    Task { await store.generateSupplierPurchaseOrder() }
                } label: {
                    Label("Recomendar compra", systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.magenta)
                .disabled(store.isSupplierPurchaseActionRunning)

                Button {
                    if let latestOrder {
                        orderPendingSubmit = latestOrder
                        showSubmitConfirmation = true
                    }
                } label: {
                    Label("Hacer compra", systemImage: "paperplane.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.blue)
                .disabled(store.isSupplierPurchaseActionRunning || latestOrder == nil || latestOrder?.status == "SUBMITTED")
            }

            SupplierPurchaseDailySummary(
                selectedDate: $selectedSummaryDate,
                orders: ordersForSelectedDay,
                submittedOrders: submittedOrdersForSelectedDay
            )
        }
        .glassPanel(padding: 16, accent: AppTheme.blue)
        .confirmationDialog("Enviar pedido a Falk & Ross", isPresented: $showSubmitConfirmation, titleVisibility: .visible) {
            Button("Enviar \(orderPendingSubmit?.orderNumber ?? "pedido")", role: .destructive) {
                if let orderPendingSubmit {
                    Task { await store.submitSupplierPurchaseOrder(orderPendingSubmit) }
                }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text(orderPendingSubmit?.orderNote ?? "Revisa cantidades y SKUs antes de confirmar. Esta accion envia el pedido al proveedor si la API esta activada.")
        }
    }
}

struct SupplierPurchaseDailySummary: View {
    @Binding var selectedDate: Date
    let orders: [SupplierPurchaseOrder]
    let submittedOrders: [SupplierPurchaseOrder]

    private var draftCount: Int {
        orders.filter { $0.status.uppercased() != "SUBMITTED" }.count
    }

    private var submittedUnits: Int {
        submittedOrders.reduce(0) { $0 + $1.totalQuantity }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                Label("Resumen finalizados", systemImage: "calendar.badge.checkmark")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                DatePicker("", selection: $selectedDate, displayedComponents: .date)
                    .labelsHidden()
                    .datePickerStyle(.compact)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 94), spacing: 8)], spacing: 8) {
                SupplierPurchaseSummaryTile(title: "Enviados", value: submittedOrders.count, color: AppTheme.green, icon: "paperplane.fill")
                SupplierPurchaseSummaryTile(title: "Borradores", value: draftCount, color: AppTheme.amber, icon: "doc.text.fill")
                SupplierPurchaseSummaryTile(title: "Prendas", value: submittedUnits, color: AppTheme.blue, icon: "shippingbox.fill")
            }

            if submittedOrders.isEmpty {
                Text("No hay compras finalizadas en este dia.")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(AppTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                VStack(spacing: 8) {
                    ForEach(submittedOrders) { order in
                        SupplierPurchaseHistoryRow(order: order)
                    }
                }
            }
        }
        .padding(12)
        .background(AppTheme.surfaceSoft)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct SupplierPurchaseSummaryTile: View {
    let title: String
    let value: Int
    let color: Color
    let icon: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.caption.weight(.black))
                .foregroundStyle(color)
                .frame(width: 24, height: 24)
                .background(color.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 0) {
                Text("\(value)")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppTheme.ink)
                Text(title)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct SupplierPurchaseHistoryRow: View {
    let order: SupplierPurchaseOrder

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(order.orderNumber)
                        .font(.subheadline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    if let externalOrderId = order.externalOrderId, !externalOrderId.isEmpty {
                        Text(externalOrderId)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(AppTheme.green)
                    }
                }
                Text(historySubtitle)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("\(order.totalQuantity)")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppTheme.blue)
                Text("prendas")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(10)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var historySubtitle: String {
        let date = order.submittedAt ?? order.createdAt ?? order.orderDate
        let time = date?.formatted(.dateTime.hour().minute()) ?? "sin hora"
        return "\(order.lines.count) lineas · enviado \(time)"
    }
}

struct SupplierPurchaseStatusBadge: View {
    let status: String

    private var color: Color {
        switch status.uppercased() {
        case "SUBMITTED": AppTheme.green
        case "ERROR": AppTheme.red
        default: AppTheme.amber
        }
    }

    var body: some View {
        Text(status.uppercased() == "SUBMITTED" ? "ENVIADO" : "BORRADOR")
            .font(.caption2.weight(.black))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(color.opacity(0.14))
            .clipShape(Capsule())
    }
}

struct SupplierPurchaseLineRow: View {
    let line: SupplierPurchaseOrderLine

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                Text(line.supplierSku)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("x\(line.quantity)")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppTheme.magenta)
                    .frame(minWidth: 42, alignment: .trailing)
                supplierStockText
                    .font(.caption2.weight(.bold))
                    .foregroundStyle((line.supplierAvailableQuantity ?? 0) >= line.quantity ? AppTheme.green : AppTheme.red)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(10)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var supplierStockText: Text {
        if line.supplierStockSpain24h != nil || line.supplierStockCentral3To5Days != nil || line.supplierStockSupplier5To20Days != nil {
            return Text("ES \(line.supplierStockSpain24h ?? 0) · DE \(line.supplierStockCentral3To5Days ?? 0) · 5-20d \(line.supplierStockSupplier5To20Days ?? 0)")
        }
        if let available = line.supplierAvailableQuantity {
            return Text("prov \(available)")
        }
        return Text("prov -")
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

    private var visibleEntries: [PurchaseMatrixEntry] {
        switch mode {
        case .recommended:
            group.entries.filter { $0.recommendedPurchaseQuantity > 0 }
        case .pending:
            group.entries.filter { $0.pendingOrderNeed > 0 }
        case .stock:
            group.entries
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(group.title)
                    .font(.headline.weight(.black))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
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

            if mode == .recommended {
                VStack(spacing: 10) {
                    ForEach(visibleEntries) { entry in
                        PurchaseBuyRow(entry: entry, accent: group.backgroundColor)
                    }
                }
                .padding(12)
                .background(AppTheme.surfaceSoft)
            } else {
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
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppTheme.line, lineWidth: 1))
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

struct PurchaseBuyRow: View {
    let entry: PurchaseMatrixEntry
    let accent: Color
    @State private var showOrders = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                if entry.imageRef != nil {
                    DTFThumbnail(entry: entry, size: 58)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(entry.subproductName)
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(2)
                    HStack(spacing: 8) {
                        MiniMetric(label: "ped", value: entry.pendingOrderNeed, color: AppTheme.blue)
                        MiniMetric(label: "stk", value: entry.currentInternalStock, color: AppTheme.green)
                        if entry.minStockTarget > 0 {
                            MiniMetric(label: "ss", value: entry.minStockTarget, color: AppTheme.amber)
                        }
                    }
                }
                Spacer(minLength: 8)
                VStack(spacing: 1) {
                    Text("\(entry.recommendedPurchaseQuantity)")
                        .font(.system(size: 38, weight: .black, design: .rounded))
                        .foregroundStyle(AppTheme.magenta)
                    Text("comprar")
                        .font(.caption2.weight(.heavy))
                        .foregroundStyle(AppTheme.muted)
                }
                .frame(width: 76)
                .padding(.vertical, 8)
                .background(AppTheme.magentaSoft)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            if !entry.demandOrders.isEmpty {
                Button {
                    withAnimation(.snappy) { showOrders.toggle() }
                } label: {
                    HStack {
                        Label("\(entry.demandOrders.count) pedido\(entry.demandOrders.count == 1 ? "" : "s") origen", systemImage: "list.bullet.rectangle")
                        Spacer()
                        Image(systemName: showOrders ? "chevron.up" : "chevron.down")
                    }
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(AppTheme.inkSoft)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(AppTheme.surfaceTinted)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)

                if showOrders {
                    PurchaseDemandLine(entry: entry)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .padding(12)
        .background(AppTheme.surfaceStrong)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(accent.opacity(0.32), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct MiniMetric: View {
    let label: String
    let value: Int
    let color: Color

    var body: some View {
        Text("\(label) \(value)")
            .font(.caption2.weight(.black))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.16))
            .clipShape(Capsule())
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

struct DTFThumbnail: View {
    let entry: PurchaseMatrixEntry
    let size: CGFloat

    private var url: URL? {
        guard let imageRef = entry.imageRef, !imageRef.isEmpty else { return nil }
        return URL(string: imageRef)
    }

    var body: some View {
        ProductImageView(url: url, title: entry.subproductName)
            .frame(width: size, height: size)
            .background(AppTheme.surfaceSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12))
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
        VStack(alignment: .leading, spacing: 8) {
            ForEach(groupedOrders, id: \.orderNumber) { order in
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(order.orderNumber) x\(order.quantity)")
                        .font(.caption.weight(.black))
                        .foregroundStyle(AppTheme.blue)
                    Text(order.titles.prefix(2).joined(separator: " · "))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(AppTheme.surfaceSoft)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }
        }
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
    @State private var showingPickStock = false
    @State private var showingFinishConfirmation = false
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

    var stockAlreadyPicked: Bool {
        switch currentOrder.status {
        case .inProduction, .produced, .picked, .readyForLabel, .labelCreated, .shipped:
            true
        default:
            false
        }
    }

    var quantityWarningMessage: String {
        repeatedQuantityItems
            .map { "\($0.displayTitle): x\($0.quantity)" }
            .joined(separator: "\n")
    }

    var finishConfirmationMessage: String {
        let lines = currentOrder.items.map { "• \($0.displayTitle) · \($0.sizeText) · x\($0.quantity)" }.joined(separator: "\n")
        if repeatedQuantityItems.isEmpty {
            return "Confirma que las prendas ya estan fabricadas y el pedido puede pasar a Envios:\n\n\(lines)"
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
                    if stockAlreadyPicked {
                        Label("Ropa base cogida. Siguiente paso: fabricar y finalizar el pedido.", systemImage: "checkmark.circle.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AppTheme.green)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(AppTheme.greenSoft)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }

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
                        if stockAlreadyPicked {
                            showingFinishConfirmation = true
                        } else {
                            showingPickStock = true
                        }
                    } label: {
                        Label(stockAlreadyPicked ? "Pedido fabricado / finalizar" : "Coger prendas del stock", systemImage: stockAlreadyPicked ? "checkmark.circle.fill" : "tshirt.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(stockAlreadyPicked ? AppTheme.green : AppTheme.blue)
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
        .sheet(isPresented: $showingPickStock) {
            NavigationStack {
                StockPickConfirmationView(order: currentOrder, pickingList: pickingList) {
                    showingPickStock = false
                    Task { await store.confirmPickingRemote(currentOrder) }
                }
            }
        }
        .alert("Finalizar pedido", isPresented: $showingFinishConfirmation) {
            Button("Cancelar", role: .cancel) {}
            Button("Finalizar y mandar a Envios") {
                Task {
                    await store.markPreparedRemote(currentOrder)
                    showingPrintPrompt = true
                }
            }
        } message: {
            Text(finishConfirmationMessage)
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

struct StockPickConfirmationView: View {
    @Environment(\.dismiss) private var dismiss
    let order: WorkshopOrder
    let pickingList: OrderPickingList?
    let onConfirm: () -> Void
    @State private var checkedLineIDs: Set<String> = []

    private var lines: [OrderPickingLine] { pickingList?.lines ?? [] }
    private var unmapped: [OrderPickingUnmapped] { pickingList?.unmapped ?? [] }
    private var allChecked: Bool {
        guard pickingList != nil else { return false }
        return lines.isEmpty || checkedLineIDs.count == lines.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Coger stock")
                        .font(.system(size: 34, weight: .black))
                        .foregroundStyle(AppTheme.ink)
                    Text("\(order.number) · \(order.customer)")
                        .font(.headline)
                        .foregroundStyle(AppTheme.muted)
                    Text("Marca cada prenda cuando la tengas fisicamente en la mano. Al continuar se descuenta del stock y pasas a fabricacion.")
                        .font(.subheadline)
                        .foregroundStyle(AppTheme.muted)
                }
                .glassPanel(accent: AppTheme.blue)

                if pickingList == nil {
                    ProgressView("Calculando prendas base...")
                        .frame(maxWidth: .infinity)
                        .glassPanel()
                } else if !unmapped.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Hay productos sin mapear", systemImage: "exclamationmark.triangle.fill")
                            .font(.headline.weight(.black))
                            .foregroundStyle(AppTheme.amber)
                        ForEach(unmapped) { item in
                            Text("\(item.title) · x\(item.quantity)")
                                .font(.subheadline.weight(.semibold))
                        }
                        Text("Puedes continuar, pero esas lineas no descontaran ropa base hasta que esten mapeadas.")
                            .font(.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                    .glassPanel(accent: AppTheme.amber)
                }

                if pickingList == nil {
                    EmptyView()
                } else if lines.isEmpty {
                    ContentUnavailableView("Sin ropa base detectada", systemImage: "shippingbox", description: Text("No hay camisetas o sudaderas mapeadas para descontar."))
                        .glassPanel()
                } else {
                    ForEach(lines) { line in
                        StockPickCheckRow(line: line, isChecked: checkedLineIDs.contains(line.id)) {
                            if checkedLineIDs.contains(line.id) {
                                checkedLineIDs.remove(line.id)
                            } else {
                                checkedLineIDs.insert(line.id)
                            }
                        }
                    }
                }

                Button {
                    onConfirm()
                } label: {
                    Label(lines.isEmpty ? "Continuar a fabricacion" : "Siguiente: fabricar", systemImage: "arrow.right.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.green)
                .controlSize(.large)
                .disabled(!allChecked)
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Coger stock")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancelar") { dismiss() }
            }
        }
    }
}

struct StockPickCheckRow: View {
    let line: OrderPickingLine
    let isChecked: Bool
    let toggle: () -> Void

    var stockAfterPick: Int { line.stockAvailable - line.quantity }

    var body: some View {
        Button(action: toggle) {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: isChecked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(isChecked ? AppTheme.green : AppTheme.mutedSoft)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(line.subproductName)
                            .font(.title3.weight(.black))
                            .foregroundStyle(AppTheme.ink)
                        Spacer()
                        Text("x\(line.quantity)")
                            .font(.system(size: 34, weight: .black, design: .rounded))
                            .foregroundStyle(AppTheme.blue)
                    }
                    FlowChips {
                        Tag(text: line.color, systemImage: "paintpalette.fill")
                        Tag(text: line.size, systemImage: "ruler.fill")
                        Tag(text: "Stock: \(line.stockAvailable)", systemImage: "tray.full.fill")
                        Tag(text: "Queda: \(stockAfterPick)", systemImage: "minus.circle.fill")
                    }
                    if line.quantity > 1 {
                        Label("Ojo: coge \(line.quantity) unidades de esta talla", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.amber)
                    }
                }
            }
            .padding(14)
            .background(isChecked ? AppTheme.greenSoft : AppTheme.surface)
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(isChecked ? AppTheme.green.opacity(0.45) : AppTheme.line))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
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
                    .clipShape(
                        UnevenRoundedRectangle(
                            topLeadingRadius: 16,
                            bottomLeadingRadius: 16,
                            bottomTrailingRadius: 0,
                            topTrailingRadius: 0
                        )
                    )
            }
            content
                .padding(padding)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .glassEffect(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [Color.white.opacity(0.18), Color.white.opacity(0.04)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .shadow(color: Color.black.opacity(0.18), radius: 20, x: 0, y: 8)
        .shadow(color: Color.black.opacity(0.08), radius: 4, x: 0, y: 2)
    }
}

struct ScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    AppTheme.canvasTop

                    Ellipse()
                        .fill(AppTheme.blue.opacity(0.55))
                        .frame(width: 420, height: 320)
                        .blur(radius: 90)
                        .offset(x: 140, y: -320)

                    Ellipse()
                        .fill(AppTheme.teal.opacity(0.40))
                        .frame(width: 340, height: 280)
                        .blur(radius: 80)
                        .offset(x: -130, y: 260)

                    Ellipse()
                        .fill(AppTheme.purple.opacity(0.35))
                        .frame(width: 300, height: 260)
                        .blur(radius: 75)
                        .offset(x: 100, y: 80)

                    Ellipse()
                        .fill(AppTheme.magenta.opacity(0.20))
                        .frame(width: 240, height: 200)
                        .blur(radius: 65)
                        .offset(x: -60, y: -120)
                }
                .ignoresSafeArea()
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

// MARK: - Influencers

enum InfluencerStageFilter: String, CaseIterable, Identifiable {
    case all = "ALL"
    case prospect = "PROSPECT"
    case contacted = "CONTACTED"
    case negotiating = "NEGOTIATING"
    case videoReceived = "VIDEO_RECEIVED"
    case published = "PUBLISHED"
    case rejected = "REJECTED"

    var id: String { rawValue }

    var apiValue: String? { self == .all ? nil : rawValue }

    var label: String {
        switch self {
        case .all: "Todas"
        case .prospect: "Prospecto"
        case .contacted: "Contactada"
        case .negotiating: "Negociando"
        case .videoReceived: "Contenido"
        case .published: "Publicado"
        case .rejected: "Descartada"
        }
    }

    var color: Color {
        switch self {
        case .all: AppTheme.purple
        case .prospect: AppTheme.amber
        case .contacted: AppTheme.blue
        case .negotiating: AppTheme.magenta
        case .videoReceived: AppTheme.teal
        case .published: AppTheme.green
        case .rejected: AppTheme.red
        }
    }

    static func label(for value: String) -> String {
        Self.allCases.first { $0.rawValue == value }?.label ?? value.replacingOccurrences(of: "_", with: " ")
    }

    static func color(for value: String) -> Color {
        Self.allCases.first { $0.rawValue == value }?.color ?? AppTheme.muted
    }
}

struct InfluencersView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var query = ""
    @State private var stage: InfluencerStageFilter = .all
    @State private var showingCreate = false
    @State private var importMessage: String?

    var filteredInfluencers: [InfluencerProfile] {
        store.influencers.sorted {
            ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Influs")
                            .font(.system(size: 42, weight: .black, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Prospección, regalos, UGC y publicaciones.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    Button {
                        Task { await importConversations() }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: store.isInfluencerActionRunning ? "hourglass" : "magnifyingglass.circle.fill")
                                .font(.title3.weight(.black))
                                .foregroundStyle(AppTheme.purple)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(store.isInfluencerActionRunning ? "Buscando conversaciones..." : "Buscar DMs de Instagram")
                                    .font(.headline.weight(.black))
                                    .foregroundStyle(AppTheme.ink)
                                Text("Revisa conversaciones abiertas y añade posibles colaboraciones.")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(AppTheme.muted)
                            }
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(store.isInfluencerActionRunning)
                    .glassPanel(padding: 14, accent: AppTheme.purple)

                    if let importMessage {
                        Text(importMessage)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppTheme.green)
                            .glassPanel(padding: 10, accent: AppTheme.green)
                    }

                    InfluencerSummaryGrid(summary: store.influencerSummary)

                    VStack(spacing: 12) {
                        TextField("Buscar @handle, nombre o tag", text: $query)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .padding(14)
                            .background(AppTheme.surfaceSoft)
                            .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .foregroundStyle(AppTheme.ink)
                            .onSubmit { Task { await reload() } }

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(InfluencerStageFilter.allCases) { item in
                                    Button {
                                        stage = item
                                        Task { await reload() }
                                    } label: {
                                        Text(item.label)
                                            .font(.caption.weight(.black))
                                            .foregroundStyle(stage == item ? AppTheme.ink : AppTheme.muted)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 8)
                                            .background(stage == item ? item.color.opacity(0.24) : AppTheme.surfaceSoft)
                                            .overlay(Capsule().stroke(stage == item ? item.color.opacity(0.55) : AppTheme.line, lineWidth: 1))
                                            .clipShape(Capsule())
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }

                    if filteredInfluencers.isEmpty {
                        InfluencerEmptyState()
                    } else {
                        ForEach(filteredInfluencers) { influencer in
                            NavigationLink(value: influencer) {
                                InfluencerCard(influencer: influencer)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Influs")
            .navigationDestination(for: InfluencerProfile.self) { influencer in
                InfluencerDetailView(influencer: influencer)
                    .environment(store)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { Task { await reload() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(store.isInfluencerActionRunning)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showingCreate = true } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showingCreate) {
                CreateInfluencerSheet()
                    .environment(store)
            }
            .task { await reload() }
            .refreshable { await reload() }
        }
    }

    private func reload() async {
        await store.loadInfluencers(stage: stage.apiValue, query: query)
    }

    private func importConversations() async {
        importMessage = nil
        do {
            let result = try await store.importInfluencerConversations()
            importMessage = result.imported == 0
                ? "Revisadas \(result.checked) conversaciones. No he encontrado nuevas colaboraciones claras."
                : "Añadidas \(result.imported) influs tras revisar \(result.checked) conversaciones."
            await reload()
        } catch {
            importMessage = nil
        }
    }
}

struct InfluencerEmptyState: View {
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.plus")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(AppTheme.purple)
            Text("Sin influs todavía")
                .font(.title3.weight(.black))
                .foregroundStyle(AppTheme.ink)
            Text("Crea la primera y empieza a ordenar el pipeline.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppTheme.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .glassPanel(padding: 20, accent: AppTheme.purple)
    }
}

struct InfluencerSummaryGrid: View {
    let summary: InfluencerSummary?

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            InfluencerMetricTile(title: "Influs", value: summary?.influencers ?? 0, icon: "person.2.fill", color: AppTheme.purple)
            InfluencerMetricTile(title: "Activas", value: summary?.activeCollaborations ?? 0, icon: "flame.fill", color: AppTheme.blue)
            InfluencerMetricTile(title: "Esperando", value: summary?.awaitingContent ?? 0, icon: "clock.badge.exclamationmark.fill", color: AppTheme.amber)
            InfluencerMetricTile(title: "UGC pendiente", value: summary?.pendingSubmissions ?? 0, icon: "video.badge.checkmark", color: AppTheme.teal)
        }
    }
}

struct InfluencerMetricTile: View {
    let title: String
    let value: Int
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.headline.weight(.black))
                .foregroundStyle(color)
                .padding(8)
                .background(color.opacity(0.16))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            Text("\(value)")
                .font(.system(size: 32, weight: .black, design: .rounded))
                .foregroundStyle(AppTheme.ink)
            Text(title.uppercased())
                .font(.caption2.weight(.black))
                .foregroundStyle(AppTheme.muted)
                .tracking(2)
        }
        .glassPanel(padding: 14, accent: color)
    }
}

struct InfluencerCard: View {
    let influencer: InfluencerProfile

    private var latestCollaboration: InfluencerCollaboration? {
        influencer.collaborations.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(InfluencerStageFilter.color(for: influencer.stage).opacity(0.18))
                    .overlay(Text(String(influencer.igHandle.prefix(1)).uppercased()).font(.headline.weight(.black)).foregroundStyle(InfluencerStageFilter.color(for: influencer.stage)))
                    .frame(width: 46, height: 46)
                VStack(alignment: .leading, spacing: 4) {
                    Text("@\(influencer.igHandle)")
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppTheme.ink)
                    if let fullName = influencer.fullName, !fullName.isEmpty {
                        Text(fullName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                Spacer()
                InfluencerStageBadge(stage: influencer.stage)
            }

            HStack(spacing: 8) {
                Tag(text: influencer.followers.map { "\($0) seg." } ?? "Sin followers", systemImage: "person.line.dotted.person.fill")
                Tag(text: "\(influencer.collaborations.count) collabs", systemImage: "sparkles")
                Tag(text: "\(influencer.submissions.count) UGC", systemImage: "play.rectangle.fill")
            }

            if influencer.detectionScore > 0 {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "wand.and.stars")
                        .font(.caption.weight(.black))
                        .foregroundStyle(AppTheme.teal)
                        .padding(7)
                        .background(AppTheme.tealSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Detectada por DM · \(influencer.detectionScore)%")
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppTheme.inkSoft)
                        if let reason = influencer.detectionReason, !reason.isEmpty {
                            Text(reason)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(AppTheme.muted)
                                .lineLimit(2)
                        }
                    }
                    Spacer()
                }
                .padding(10)
                .background(AppTheme.tealSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if let latestCollaboration {
                VStack(alignment: .leading, spacing: 4) {
                    Text(latestCollaboration.title)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(AppTheme.inkSoft)
                    Text(statusLabel(latestCollaboration.status))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(AppTheme.surfaceSoft)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            if let lastMessage = influencer.lastMessage, !lastMessage.isEmpty {
                Text(lastMessage)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppTheme.muted)
                    .lineLimit(2)
            }
        }
        .glassPanel(padding: 14, accent: InfluencerStageFilter.color(for: influencer.stage))
    }

    private func statusLabel(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct InfluencerStageBadge: View {
    let stage: String

    var body: some View {
        Text(InfluencerStageFilter.label(for: stage).uppercased())
            .font(.caption2.weight(.black))
            .foregroundStyle(InfluencerStageFilter.color(for: stage))
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(InfluencerStageFilter.color(for: stage).opacity(0.16))
            .clipShape(Capsule())
    }
}

struct InfluencerDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let influencer: InfluencerProfile
    @State private var selectedStage: InfluencerStageFilter

    init(influencer: InfluencerProfile) {
        self.influencer = influencer
        _selectedStage = State(initialValue: InfluencerStageFilter.allCases.first { $0.rawValue == influencer.stage } ?? .prospect)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("@\(influencer.igHandle)")
                        .font(.system(size: 38, weight: .black, design: .rounded))
                        .foregroundStyle(AppTheme.ink)
                    if let fullName = influencer.fullName {
                        Text(fullName)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                    InfluencerStageBadge(stage: influencer.stage)
                }
                .glassPanel(padding: 16, accent: InfluencerStageFilter.color(for: influencer.stage))

                VStack(alignment: .leading, spacing: 10) {
                    SectionHeader(title: "Estado", subtitle: "Mueve la influ por el pipeline")
                    Picker("Estado", selection: $selectedStage) {
                        ForEach(InfluencerStageFilter.allCases.filter { $0 != .all }) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    .pickerStyle(.menu)
                    Button {
                        Task { await store.updateInfluencerStage(influencer, stage: selectedStage.rawValue) }
                    } label: {
                        Label("Guardar estado", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isInfluencerActionRunning || selectedStage.rawValue == influencer.stage)
                }
                .glassPanel(padding: 16, accent: selectedStage.color)

                if influencer.detectionScore > 0 {
                    VStack(alignment: .leading, spacing: 10) {
                        SectionHeader(title: "Detección automática", subtitle: "Por qué apareció desde Instagram")
                        HStack(alignment: .top, spacing: 14) {
                            Text("\(influencer.detectionScore)%")
                                .font(.system(size: 34, weight: .black, design: .rounded))
                                .foregroundStyle(AppTheme.teal)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(influencer.detectionReason ?? "Detectada desde DM")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(AppTheme.inkSoft)
                                if let suggestedAction = influencer.suggestedAction, !suggestedAction.isEmpty {
                                    Text(suggestedAction)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(AppTheme.muted)
                                }
                            }
                            Spacer()
                        }
                    }
                    .glassPanel(padding: 16, accent: AppTheme.teal)
                }

                if !influencer.collaborations.isEmpty {
                    SectionHeader(title: "Colaboraciones", subtitle: "\(influencer.collaborations.count) abiertas o históricas")
                    ForEach(influencer.collaborations) { collab in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(collab.title)
                                    .font(.headline.weight(.black))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                Text(collab.status.replacingOccurrences(of: "_", with: " "))
                                    .font(.caption.weight(.black))
                                    .foregroundStyle(AppTheme.blue)
                            }
                            if let deliverables = collab.deliverables {
                                Text(deliverables)
                                    .font(.footnote)
                                    .foregroundStyle(AppTheme.muted)
                            }
                        }
                        .glassPanel(padding: 12, accent: AppTheme.blue)
                    }
                }

                if let notes = influencer.notes, !notes.isEmpty {
                    SectionHeader(title: "Notas", subtitle: "Contexto interno")
                    Text(notes)
                        .font(.body)
                        .foregroundStyle(AppTheme.inkSoft)
                        .glassPanel(padding: 14)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Influ")
        .refreshable { await store.loadInfluencers() }
    }
}

struct CreateInfluencerSheet: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var handle = ""
    @State private var name = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Perfil") {
                    TextField("@instagram", text: $handle)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Nombre", text: $name)
                    TextField("Notas", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Nueva influ")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cerrar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crear") {
                        Task {
                            await store.createInfluencer(handle: handle, name: name, notes: notes)
                            dismiss()
                        }
                    }
                    .disabled(handle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.isInfluencerActionRunning)
                }
            }
        }
    }
}

// MARK: - Meta Ads

struct MetaAdsView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var summary: MetaSummary?
    @State private var health: AdsHealth?
    @State private var loading = false
    @State private var error: String?
    @State private var range: MetaRange = .today
    @State private var customFrom = Calendar.current.startOfDay(for: Date())
    @State private var customTo = Calendar.current.startOfDay(for: Date())
    @State private var showCreate = false
    @State private var statusBusy: String?
    @State private var searchText = ""
    @State private var campaignFilter: CampaignFilter = .all
    @State private var campaignSort: CampaignSort = .spend

    enum MetaRange: String, CaseIterable, Identifiable {
        case today, week, month, custom
        var id: String { rawValue }
        var label: String {
            switch self {
            case .today: "Hoy"; case .week: "Semana"; case .month: "Mes"; case .custom: "Calendario"
            }
        }
    }

    enum CampaignFilter: String, CaseIterable, Identifiable {
        case all, active, paused, attention
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: "Todas"
            case .active: "Activas"
            case .paused: "Pausadas"
            case .attention: "Revisar"
            }
        }
    }

    enum CampaignSort: String, CaseIterable, Identifiable {
        case spend, roas, purchases, ctr, name
        var id: String { rawValue }
        var label: String {
            switch self {
            case .spend: "Gasto"
            case .roas: "ROAS"
            case .purchases: "Compras"
            case .ctr: "CTR"
            case .name: "Nombre"
            }
        }
    }

    private var dateRange: (from: Date, to: Date) {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        switch range {
        case .today: return (today, today)
        case .week: return (cal.date(byAdding: .day, value: -6, to: today) ?? today, today)
        case .month: return (cal.date(from: cal.dateComponents([.year, .month], from: today)) ?? today, today)
        case .custom: return (customFrom, customTo)
        }
    }

    private var filteredCampaigns: [MetaCampaign] {
        guard let campaigns = summary?.campaigns else { return [] }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return campaigns
            .filter { campaign in
                switch campaignFilter {
                case .all: true
                case .active: campaign.status == "ACTIVE"
                case .paused: campaign.status != "ACTIVE"
                case .attention: campaign.spend > 0 && (campaign.purchases == 0 || (campaign.roas ?? 0) < 1)
                }
            }
            .filter { campaign in
                query.isEmpty
                || campaign.name.lowercased().contains(query)
                || campaign.status.lowercased().contains(query)
                || (campaign.objective ?? "").lowercased().contains(query)
            }
            .sorted { a, b in
                switch campaignSort {
                case .spend: a.spend == b.spend ? a.name < b.name : a.spend > b.spend
                case .roas: (a.roas ?? -1) == (b.roas ?? -1) ? a.spend > b.spend : (a.roas ?? -1) > (b.roas ?? -1)
                case .purchases: a.purchases == b.purchases ? a.spend > b.spend : a.purchases > b.purchases
                case .ctr: (a.ctr ?? -1) == (b.ctr ?? -1) ? a.spend > b.spend : (a.ctr ?? -1) > (b.ctr ?? -1)
                case .name: a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
                }
            }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Meta Ads")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Gasto, campañas y lo más vendido.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    Picker("Rango", selection: $range) {
                        ForEach(MetaRange.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: range) { _, _ in Task { await reload() } }

                    if range == .custom {
                        CustomEconomicsDatePicker(
                            from: $customFrom,
                            to: $customTo,
                            loading: loading,
                            onApply: { Task { await reload() } }
                        )
                    }

                    if loading && summary == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let summary {
                        if !summary.configured {
                            Label("Meta Ads no configurado. Falta el token o la cuenta publicitaria en el servidor.", systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(AppTheme.amber)
                                .padding(10)
                                .glassPanel(padding: 10, accent: AppTheme.amber)
                        }
                        if let health { AdsHealthCard(health: health) }
                        MetaKpiCard(summary: summary)
                        MetaRecommendationsCard(
                            title: "Recomendaciones",
                            subtitle: "Lectura experta del rendimiento actual",
                            recommendations: summary.recommendations ?? [],
                            onApplied: { Task { await reload() } }
                        )

                        if !summary.campaigns.isEmpty {
                            SectionHeader(title: "Campañas", subtitle: "\(filteredCampaigns.count) de \(summary.campaigns.count) en el rango seleccionado")
                            MetaCampaignToolbar(
                                searchText: $searchText,
                                filter: $campaignFilter,
                                sort: $campaignSort
                            )
                            if filteredCampaigns.isEmpty {
                                EmptyStateCard(
                                    title: "Sin campañas con estos filtros",
                                    subtitle: "Cambia la busqueda, el estado o la ordenacion."
                                )
                            } else {
                                ForEach(filteredCampaigns) { c in
                                    VStack(spacing: 10) {
                                        MetaCampaignRow(
                                            campaign: c,
                                            busy: statusBusy == c.id,
                                            onToggle: { Task { await toggle(c) } }
                                        )
                                        NavigationLink(value: c.id) {
                                            Label("Entrar en campaña", systemImage: "rectangle.stack.fill")
                                                .font(.caption.weight(.heavy))
                                                .frame(maxWidth: .infinity)
                                                .padding(.vertical, 10)
                                                .background(AppTheme.blue.opacity(0.16), in: Capsule())
                                                .foregroundStyle(AppTheme.blue)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                        }

                        if !summary.bestSellers.isEmpty {
                            SectionHeader(title: "Lo más vendido", subtitle: "Por unidades en el rango")
                            ForEach(Array(summary.bestSellers.enumerated()), id: \.element.id) { idx, b in
                                MetaBestSellerRow(rank: idx + 1, seller: b)
                            }
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
            .navigationTitle("Meta Ads")
            .navigationDestination(for: String.self) { campaignId in
                let r = dateRange
                MetaCampaignDetailView(campaignId: campaignId, from: r.from, to: r.to)
                    .environment(store)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showCreate = true } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button { Task { await reload() } } label: {
                        Image(systemName: "arrow.clockwise")
                    }.disabled(loading)
                }
            }
            .sheet(isPresented: $showCreate) {
                MetaCreateAdSheet(onCreated: { Task { await reload() } })
                    .environment(store)
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
            let r = dateRange
            async let s = client.metaSummary(from: r.from, to: r.to)
            async let h = client.adsHealth(from: r.from, to: r.to)
            summary = try await s
            health = try? await h
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func toggle(_ c: MetaCampaign) async {
        guard let client = store.apiClient else { return }
        let next = c.status == "ACTIVE" ? "PAUSED" : "ACTIVE"
        statusBusy = c.id
        defer { statusBusy = nil }
        do {
            try await client.metaSetCampaignStatus(c.id, status: next)
            await reload()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct AdsHealthCard: View {
    let health: AdsHealth
    private func color(_ s: String) -> Color {
        switch s { case "GOOD": AppTheme.green; case "WATCH": AppTheme.amber; case "BAD": AppTheme.red; default: AppTheme.muted }
    }
    private func icon(_ s: String) -> String {
        switch s { case "GOOD": "checkmark.seal.fill"; case "WATCH": "exclamationmark.triangle.fill"; case "BAD": "xmark.octagon.fill"; default: "info.circle.fill" }
    }
    private var verdictWord: String {
        switch health.status { case "GOOD": "VAMOS BIEN"; case "WATCH": "JUSTO"; case "BAD": "VAMOS MAL"; default: "SIN GASTO" }
    }
    private func eur(_ v: Double) -> String { String(format: "%.0f €", v) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: icon(health.status)).font(.title2).foregroundStyle(color(health.status))
                VStack(alignment: .leading, spacing: 2) {
                    Text(verdictWord).font(.subheadline.weight(.black)).foregroundStyle(color(health.status))
                    Text(health.headline).font(.caption).foregroundStyle(AppTheme.ink).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
            }
            Divider().background(AppTheme.line)
            HStack(spacing: 10) {
                MetaStat(title: "Gasto ads", value: eur(health.spend), accent: AppTheme.red)
                MetaStat(title: "Ventas", value: "\(health.orders) · \(eur(health.salesRevenue))", accent: AppTheme.green)
                MetaStat(title: "ROAS", value: health.roas.map { String(format: "%.1fx", $0) } ?? "—", accent: AppTheme.blue)
            }
            if let be = health.breakEvenCpa {
                Text("Equilibrio: cada venta debe costar menos de \(eur(be)) (tu margen por pedido).")
                    .font(.caption2).foregroundStyle(AppTheme.muted)
            }
            if !health.campaigns.isEmpty {
                Divider().background(AppTheme.line)
                ForEach(health.campaigns) { c in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(color(c.status)).frame(width: 8, height: 8).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(c.name).font(.caption.weight(.bold)).foregroundStyle(AppTheme.ink).lineLimit(1)
                            Text(c.message).font(.caption2).foregroundStyle(AppTheme.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                    }
                }
            }
        }
        .glassPanel(padding: 16, accent: color(health.status))
    }
}

struct MetaKpiCard: View {
    let summary: MetaSummary
    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                MetaStat(title: "Gasto", value: euro(summary.spend), accent: AppTheme.red)
                MetaStat(title: "Ingresos atrib.", value: euro(summary.attributedRevenue), accent: AppTheme.green)
            }
            HStack(spacing: 12) {
                MetaStat(title: "ROAS", value: summary.roas.map { String(format: "%.2fx", $0) } ?? "—", accent: AppTheme.blue)
                MetaStat(title: "Compras", value: "\(summary.purchases)", accent: AppTheme.amber)
                MetaStat(title: "Activas", value: "\(summary.activeCampaigns)", accent: AppTheme.ink)
            }
        }
        .padding()
        .glassPanel(padding: 16, accent: AppTheme.blue)
    }

    private func euro(_ v: Double) -> String { String(format: "%.2f €", v) }
}

struct MetaStat: View {
    let title: String
    let value: String
    let accent: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.heavy))
                .foregroundStyle(AppTheme.muted)
            Text(value)
                .font(.system(size: 19, weight: .heavy, design: .rounded))
                .foregroundStyle(accent)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MetaRecommendationsCard: View {
    @Environment(WorkshopStore.self) private var store
    let title: String
    let subtitle: String
    let recommendations: [MetaRecommendation]
    let onApplied: () -> Void
    @State private var applyingId: String?
    @State private var resultMessage: String?
    @State private var errorMessage: String?
    @State private var history = MetaRecommendationDecisionStore.load()
    @State private var autoApplying = false
    @AppStorage("metaAutoApplyRecommendationsEnabled.v1") private var autoApplyFutureRecommendations = false

    private var automaticCount: Int {
        recommendations.filter(\.isAutomaticallyApplicable).count
    }

    private var pendingAutomaticRecommendations: [MetaRecommendation] {
        recommendations
            .prefix(6)
            .filter { $0.isAutomaticallyApplicable }
            .filter { recommendation in
                !history.contains { $0.recommendationId == recommendation.id }
            }
    }

    private var autoApplyTaskKey: String {
        let ids = recommendations.prefix(6).map(\.id).joined(separator: "|")
        let applied = history.map(\.recommendationId).joined(separator: "|")
        return "\(autoApplyFutureRecommendations)-\(ids)-\(applied)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text(subtitle)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(recommendations.count)")
                        .font(.caption.weight(.heavy))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(AppTheme.blue.opacity(0.16), in: Capsule())
                        .foregroundStyle(AppTheme.blue)
                    if !recommendations.isEmpty {
                        Text("\(automaticCount) aplicables")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }

            if !recommendations.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Toggle(isOn: $autoApplyFutureRecommendations) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Auto aplicar futuras")
                                .font(.caption.weight(.heavy))
                                .foregroundStyle(AppTheme.ink)
                            Text(autoApplyFutureRecommendations ? "Activo: aplicara subidas/pausas seguras al refrescar." : "Apagado: solo aplicas cambios cuando pulses el boton.")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(AppTheme.muted)
                        }
                    }
                    .toggleStyle(.switch)
                    if autoApplyFutureRecommendations {
                        Label(
                            pendingAutomaticRecommendations.isEmpty ? "No hay recomendaciones automaticas pendientes." : "\(pendingAutomaticRecommendations.count) recomendacion(es) se aplicaran automaticamente.",
                            systemImage: autoApplying ? "arrow.triangle.2.circlepath" : "shield.checkered"
                        )
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(autoApplying ? AppTheme.amber : AppTheme.green)
                    }
                }
                .padding(12)
                .background(AppTheme.surfaceSoft, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.green.opacity(autoApplyFutureRecommendations ? 0.35 : 0.12)))
            }

            if recommendations.isEmpty {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(AppTheme.green)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Sin alertas claras")
                            .font(.subheadline.weight(.heavy))
                            .foregroundStyle(AppTheme.ink)
                        Text("No hay suficiente señal negativa o positiva para recomendar cambios fuertes.")
                            .font(.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                .padding(12)
                .background(AppTheme.surfaceSoft, in: RoundedRectangle(cornerRadius: 14))
            } else {
                ForEach(recommendations.prefix(6)) { recommendation in
                    MetaRecommendationRow(
                        recommendation: recommendation,
                        applying: applyingId == recommendation.id,
                        decision: history.first { $0.recommendationId == recommendation.id },
                        onApply: { Task { await apply(recommendation) } },
                        onManualReview: { markManual(recommendation) }
                    )
                }
            }

            if let resultMessage {
                Label(resultMessage, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.green)
                    .padding(10)
                    .background(AppTheme.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }

            if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.red)
                    .padding(10)
                    .background(AppTheme.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            }

            if !history.isEmpty {
                MetaRecommendationHistoryView(history: history)
            }
        }
        .glassPanel(padding: 14, accent: AppTheme.amber)
        .task(id: autoApplyTaskKey) {
            await autoApplyPendingIfNeeded()
        }
    }

    private func apply(_ recommendation: MetaRecommendation, source: String = "manual", reloadAfterApply: Bool = true) async {
        guard let client = store.apiClient else {
            errorMessage = "API no configurada"
            return
        }
        guard recommendation.isAutomaticallyApplicable, let targetId = recommendation.targetId else {
            errorMessage = "Esta recomendacion requiere revision manual"
            return
        }
        applyingId = recommendation.id
        resultMessage = nil
        errorMessage = nil
        defer { applyingId = nil }
        do {
            let result = try await client.metaApplyRecommendation(MetaApplyRecommendationRequest(
                targetType: recommendation.targetType,
                targetId: targetId,
                severity: recommendation.severity,
                suggestedDailyBudget: recommendation.suggestedDailyBudget
            ))
            resultMessage = result.message
            let prefix = source == "auto" ? "Auto " : ""
            record(recommendation, decision: prefix + (recommendation.severity == "PAUSE" ? "pausada" : "aplicada"), message: result.message)
            if reloadAfterApply { onApplied() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func autoApplyPendingIfNeeded() async {
        guard autoApplyFutureRecommendations, !autoApplying else { return }
        let pending = pendingAutomaticRecommendations
        guard !pending.isEmpty else { return }

        autoApplying = true
        errorMessage = nil
        resultMessage = nil
        defer { autoApplying = false }

        var applied = 0
        for recommendation in pending {
            await apply(recommendation, source: "auto", reloadAfterApply: false)
            if errorMessage == nil { applied += 1 }
        }
        if applied > 0 {
            resultMessage = "Auto aplicado: \(applied) recomendacion(es)."
            onApplied()
        }
    }

    private func markManual(_ recommendation: MetaRecommendation) {
        resultMessage = "Recomendacion marcada para revision manual."
        errorMessage = nil
        record(recommendation, decision: "Revision manual", message: recommendation.action)
    }

    private func record(_ recommendation: MetaRecommendation, decision: String, message: String) {
        let entry = MetaRecommendationDecision(
            id: UUID().uuidString,
            recommendationId: recommendation.id,
            targetName: recommendation.targetName,
            title: recommendation.title,
            severity: recommendation.severity,
            decision: decision,
            message: message,
            createdAt: Date()
        )
        history = MetaRecommendationDecisionStore.save([entry] + history)
    }
}

struct MetaRecommendationRow: View {
    let recommendation: MetaRecommendation
    let applying: Bool
    let decision: MetaRecommendationDecision?
    let onApply: () -> Void
    let onManualReview: () -> Void
    @State private var confirming = false

    private var confirmSummary: String {
        switch recommendation.severity {
        case "SCALE":
            if recommendation.targetType == "CAMPAIGN" {
                return "Se subirá el presupuesto diario un +15% en \(recommendation.targetName) (en la campaña o en sus grupos activos). El cambio se aplica YA en Meta Ads."
            }
            if let b = recommendation.suggestedDailyBudget {
                return "Se subirá el presupuesto diario de \(recommendation.targetName) a \(String(format: "%.2f €", b)). Se aplica YA en Meta Ads."
            }
            return "Se subirá el presupuesto diario un +15% en \(recommendation.targetName). Se aplica YA en Meta Ads."
        case "PAUSE":
            return "Se PAUSARÁ \(recommendation.targetName) en Meta Ads ahora mismo. Dejará de gastar y de mostrarse."
        default:
            return "Se aplicará el cambio en Meta Ads."
        }
    }

    private var impactText: String {
        switch recommendation.severity {
        case "SCALE":
            if recommendation.targetType == "CAMPAIGN" {
                return "Impacto: sube presupuesto diario un 15% en campaña o grupos activos."
            }
            if recommendation.targetType == "AD" {
                return "Impacto: sube un 15% el presupuesto del grupo donde esta este anuncio."
            }
            if let current = recommendation.currentDailyBudget, let suggested = recommendation.suggestedDailyBudget {
                return "Impacto: \(String(format: "%.2f €", current)) -> \(String(format: "%.2f €", suggested)) al dia."
            }
            if let suggested = recommendation.suggestedDailyBudget {
                return "Impacto: nuevo presupuesto diario \(String(format: "%.2f €", suggested))."
            }
            return "Impacto: subida de presupuesto pendiente de calcular."
        case "PAUSE":
            return "Impacto: deja de gastar y de mostrarse desde Meta Ads."
        default:
            return manualReason
        }
    }

    private var manualReason: String {
        if recommendation.targetId == nil {
            return "Revision manual: no hay objetivo directo en Meta Ads."
        }
        switch recommendation.severity {
        case "FIX":
            return "Revision manual: hay que corregir configuracion o creatividad antes de tocar presupuesto."
        case "WATCH":
            return "Revision manual: aun no hay señal suficiente para tocar Meta Ads automaticamente."
        case "INFO":
            return "Informativo: sirve para entender el rendimiento, no para aplicar cambios."
        case "SCALE":
            if recommendation.targetType == "AD" {
                return "Impacto: sube un 15% el presupuesto del grupo donde esta este anuncio."
            }
            return "Revision manual: falta presupuesto sugerido editable."
        default:
            return "Revision manual: esta recomendacion no tiene accion automatica segura."
        }
    }

    private var color: Color {
        switch recommendation.severity {
        case "SCALE": AppTheme.green
        case "PAUSE": AppTheme.red
        case "FIX": AppTheme.amber
        case "WATCH": AppTheme.blue
        default: AppTheme.muted
        }
    }

    private var icon: String {
        switch recommendation.severity {
        case "SCALE": "arrow.up.right.circle.fill"
        case "PAUSE": "pause.circle.fill"
        case "FIX": "wrench.and.screwdriver.fill"
        case "WATCH": "eye.circle.fill"
        default: "info.circle.fill"
        }
    }

    private var label: String {
        switch recommendation.severity {
        case "SCALE": "ESCALAR"
        case "PAUSE": "PAUSAR"
        case "FIX": "ARREGLAR"
        case "WATCH": "VIGILAR"
        default: "INFO"
        }
    }

    private var applyTitle: String {
        switch recommendation.severity {
        case "SCALE": "Aplicar subida"
        case "PAUSE": "Pausar ahora"
        default: "Manual"
        }
    }

    private var isAppliedDecision: Bool {
        guard let decision else { return false }
        return decision.decision.lowercased().contains("aplicada")
            || decision.decision.lowercased().contains("pausada")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(color)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(label)
                            .font(.caption2.weight(.black))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(color.opacity(0.18), in: Capsule())
                            .foregroundStyle(color)
                        Text(recommendation.metricLabel)
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(AppTheme.muted)
                    }
                    Text(recommendation.title)
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text(recommendation.targetName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                        .lineLimit(1)
                }
                Spacer()
            }
            Text(recommendation.reason)
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
            Text(recommendation.action)
                .font(.caption.weight(.bold))
                .foregroundStyle(color)
                .fixedSize(horizontal: false, vertical: true)
            Label(impactText, systemImage: recommendation.isAutomaticallyApplicable ? "bolt.fill" : "hand.raised.fill")
                .font(.caption2.weight(.bold))
                .foregroundStyle(recommendation.isAutomaticallyApplicable ? color : AppTheme.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background((recommendation.isAutomaticallyApplicable ? color : AppTheme.muted).opacity(0.12), in: RoundedRectangle(cornerRadius: 10))

            if let decision {
                VStack(alignment: .leading, spacing: 4) {
                    Label(isAppliedDecision ? "Aplicada en Meta" : "Revisada", systemImage: isAppliedDecision ? "checkmark.seal.fill" : "checkmark.circle.fill")
                        .font(.caption.weight(.black))
                        .foregroundStyle(isAppliedDecision ? AppTheme.green : AppTheme.blue)
                    Text(decision.message)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(shortDate(decision.createdAt))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background((isAppliedDecision ? AppTheme.green : AppTheme.blue).opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke((isAppliedDecision ? AppTheme.green : AppTheme.blue).opacity(0.25)))
            } else if recommendation.isAutomaticallyApplicable {
                Button(action: { confirming = true }) {
                    if applying {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Label(applyTitle, systemImage: recommendation.severity == "PAUSE" ? "pause.fill" : "arrow.up.right")
                            .font(.caption.weight(.heavy))
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(color)
                .disabled(applying)
                .confirmationDialog(applyTitle, isPresented: $confirming, titleVisibility: .visible) {
                    Button(recommendation.severity == "PAUSE" ? "Pausar ahora" : "Sí, subir presupuesto",
                           role: recommendation.severity == "PAUSE" ? .destructive : nil) {
                        onApply()
                    }
                    Button("Cancelar", role: .cancel) {}
                } message: {
                    Text(confirmSummary)
                }
            } else {
                Button(action: onManualReview) {
                    Label("Marcar revisada", systemImage: "checkmark.circle")
                        .font(.caption.weight(.heavy))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(AppTheme.muted)
            }
        }
        .padding(12)
        .background(AppTheme.surfaceSoft, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(color.opacity(0.28)))
    }

    private func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es_ES")
        formatter.dateFormat = "d MMM HH:mm"
        return formatter.string(from: date)
    }
}

struct MetaRecommendationDecision: Codable, Identifiable {
    let id: String
    let recommendationId: String
    let targetName: String
    let title: String
    let severity: String
    let decision: String
    let message: String
    let createdAt: Date
}

enum MetaRecommendationDecisionStore {
    private static let key = "metaRecommendationDecisionHistory.v1"
    private static let limit = 12

    static func load() -> [MetaRecommendationDecision] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([MetaRecommendationDecision].self, from: data)) ?? []
    }

    @discardableResult
    static func save(_ history: [MetaRecommendationDecision]) -> [MetaRecommendationDecision] {
        let trimmed = Array(history.prefix(limit))
        if let data = try? JSONEncoder().encode(trimmed) {
            UserDefaults.standard.set(data, forKey: key)
        }
        return trimmed
    }
}

struct MetaRecommendationHistoryView: View {
    let history: [MetaRecommendationDecision]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Historial reciente", systemImage: "clock.arrow.circlepath")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Text("\(history.count)")
                    .font(.caption2.weight(.black))
                    .foregroundStyle(AppTheme.muted)
            }
            ForEach(history.prefix(4)) { item in
                HStack(alignment: .top, spacing: 9) {
                    Circle()
                        .fill(color(for: item.severity))
                        .frame(width: 8, height: 8)
                        .padding(.top, 5)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(item.decision) · \(item.targetName)")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(1)
                        Text(item.message)
                            .font(.caption2)
                            .foregroundStyle(AppTheme.muted)
                            .lineLimit(2)
                        Text(shortDate(item.createdAt))
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(AppTheme.muted.opacity(0.8))
                    }
                }
            }
        }
        .padding(12)
        .background(AppTheme.surfaceSoft, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line.opacity(0.6)))
    }

    private func color(for severity: String) -> Color {
        switch severity {
        case "SCALE": AppTheme.green
        case "PAUSE": AppTheme.red
        case "FIX": AppTheme.amber
        case "WATCH": AppTheme.blue
        default: AppTheme.muted
        }
    }

    private func shortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "es_ES")
        formatter.dateFormat = "d MMM HH:mm"
        return formatter.string(from: date)
    }
}

struct MetaCampaignToolbar: View {
    @Binding var searchText: String
    @Binding var filter: MetaAdsView.CampaignFilter
    @Binding var sort: MetaAdsView.CampaignSort

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(AppTheme.muted)
                TextField("Buscar campaña, objetivo o estado", text: $searchText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !searchText.isEmpty {
                    Button { searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(AppTheme.muted)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            .background(AppTheme.surfaceSoft, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppTheme.line))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(MetaAdsView.CampaignFilter.allCases) { item in
                        Button { filter = item } label: {
                            Text(item.label)
                                .font(.caption.weight(.heavy))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background((filter == item ? AppTheme.blue : AppTheme.surfaceSoft).opacity(filter == item ? 0.22 : 1), in: Capsule())
                                .foregroundStyle(filter == item ? AppTheme.blue : AppTheme.muted)
                                .overlay(Capsule().stroke(filter == item ? AppTheme.blue.opacity(0.45) : AppTheme.line))
                        }
                        .buttonStyle(.plain)
                    }
                    Menu {
                        ForEach(MetaAdsView.CampaignSort.allCases) { item in
                            Button(item.label) { sort = item }
                        }
                    } label: {
                        Label(sort.label, systemImage: "arrow.up.arrow.down")
                            .font(.caption.weight(.heavy))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(AppTheme.amber.opacity(0.16), in: Capsule())
                            .foregroundStyle(AppTheme.amber)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .glassPanel(padding: 12, accent: AppTheme.blue)
    }
}

struct MetaCampaignDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let campaignId: String
    let from: Date
    let to: Date

    @State private var detail: MetaCampaignDetail?
    @State private var loading = false
    @State private var error: String?
    @State private var selectedTab: Tab = .adsets
    @State private var sort: Sort = .spend

    enum Tab: String, CaseIterable, Identifiable {
        case adsets, ads
        var id: String { rawValue }
        var label: String { self == .adsets ? "Grupos" : "Anuncios" }
    }

    enum Sort: String, CaseIterable, Identifiable {
        case spend, roas, purchases, ctr
        var id: String { rawValue }
        var label: String {
            switch self {
            case .spend: "Gasto"
            case .roas: "ROAS"
            case .purchases: "Compras"
            case .ctr: "CTR"
            }
        }
    }

    private var sortedAdsets: [MetaAdSet] {
        (detail?.adsets ?? []).sorted { compare($0, $1) }
    }

    private var sortedAds: [MetaAd] {
        (detail?.ads ?? []).sorted { compare($0, $1) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if loading && detail == nil {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let detail {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(detail.campaign.name)
                            .font(.system(size: 28, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(3)
                        HStack(spacing: 8) {
                            MetaStatusBadge(status: detail.campaign.status)
                            if let objective = detail.campaign.objective {
                                Text(objective)
                                    .font(.caption.weight(.heavy))
                                    .foregroundStyle(AppTheme.muted)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 5)
                                    .background(AppTheme.surfaceSoft, in: Capsule())
                            }
                        }
                    }

                    MetaKpiCard(summary: MetaSummary(
                        from: detail.from,
                        to: detail.to,
                        configured: true,
                        currency: "EUR",
                        spend: detail.campaign.spend,
                        attributedRevenue: detail.campaign.purchaseValue,
                        purchases: detail.campaign.purchases,
                        roas: detail.campaign.roas,
                        activeCampaigns: detail.campaign.status == "ACTIVE" ? 1 : 0,
                        campaigns: [detail.campaign],
                        recommendations: nil,
                        bestSellers: []
                    ))
                    MetaRecommendationsCard(
                        title: "Que haria ahora",
                        subtitle: "Campaña, grupos y anuncios de esta vista",
                        recommendations: detail.recommendations ?? [],
                        onApplied: { Task { await reload() } }
                    )

                    HStack(spacing: 10) {
                        Picker("Vista", selection: $selectedTab) {
                            ForEach(Tab.allCases) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Menu {
                            ForEach(Sort.allCases) { item in
                                Button(item.label) { sort = item }
                            }
                        } label: {
                            Image(systemName: "arrow.up.arrow.down.circle.fill")
                                .font(.title2)
                                .foregroundStyle(AppTheme.blue)
                        }
                    }

                    if selectedTab == .adsets {
                        SectionHeader(title: "Grupos de anuncios", subtitle: "\(sortedAdsets.count) dentro de esta campaña")
                        ForEach(sortedAdsets) { adset in
                            MetaAdSetCard(adset: adset)
                        }
                    } else {
                        SectionHeader(title: "Anuncios", subtitle: "\(sortedAds.count) creatividades y piezas")
                        ForEach(sortedAds) { ad in
                            MetaAdCard(ad: ad)
                        }
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
        .navigationTitle("Campaña")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await reload() } } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading)
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    private func reload() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            detail = try await client.metaCampaignDetail(id: campaignId, from: from, to: to)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func compare(_ a: MetaAdSet, _ b: MetaAdSet) -> Bool {
        switch sort {
        case .spend: a.spend == b.spend ? a.name < b.name : a.spend > b.spend
        case .roas: (a.roas ?? -1) == (b.roas ?? -1) ? a.spend > b.spend : (a.roas ?? -1) > (b.roas ?? -1)
        case .purchases: a.purchases == b.purchases ? a.spend > b.spend : a.purchases > b.purchases
        case .ctr: (a.ctr ?? -1) == (b.ctr ?? -1) ? a.spend > b.spend : (a.ctr ?? -1) > (b.ctr ?? -1)
        }
    }

    private func compare(_ a: MetaAd, _ b: MetaAd) -> Bool {
        switch sort {
        case .spend: a.spend == b.spend ? a.name < b.name : a.spend > b.spend
        case .roas: (a.roas ?? -1) == (b.roas ?? -1) ? a.spend > b.spend : (a.roas ?? -1) > (b.roas ?? -1)
        case .purchases: a.purchases == b.purchases ? a.spend > b.spend : a.purchases > b.purchases
        case .ctr: (a.ctr ?? -1) == (b.ctr ?? -1) ? a.spend > b.spend : (a.ctr ?? -1) > (b.ctr ?? -1)
        }
    }
}

struct MetaStatusBadge: View {
    let status: String
    private var isActive: Bool { status == "ACTIVE" }
    var body: some View {
        Text(isActive ? "ACTIVA" : status)
            .font(.caption2.weight(.heavy))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background((isActive ? AppTheme.green : AppTheme.muted).opacity(0.18), in: Capsule())
            .foregroundStyle(isActive ? AppTheme.green : AppTheme.muted)
    }
}

struct MetaAdSetCard: View {
    let adset: MetaAdSet
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(adset.name)
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text([adset.optimizationGoal, adset.billingEvent].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                MetaStatusBadge(status: adset.status)
            }
            if let budget = adset.dailyBudget ?? adset.lifetimeBudget {
                Label(String(format: "%.2f € de presupuesto", budget), systemImage: "eurosign.circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.amber)
            }
            MetaPerformanceGrid(spend: adset.spend, roas: adset.roas, purchases: adset.purchases, ctr: adset.ctr, impressions: adset.impressions, clicks: adset.clicks)
        }
        .padding()
        .glassPanel(padding: 14, accent: adset.status == "ACTIVE" ? AppTheme.green : AppTheme.blue)
    }
}

struct MetaAdCard: View {
    let ad: MetaAd
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AsyncImage(url: ad.thumbnailUrl.flatMap { URL(string: $0) }) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    ZStack {
                        AppTheme.surfaceSoft
                        Image(systemName: "photo")
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(ad.name)
                            .font(.headline.weight(.heavy))
                            .foregroundStyle(AppTheme.ink)
                            .lineLimit(2)
                        if let creativeName = ad.creativeName {
                            Text(creativeName)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AppTheme.muted)
                                .lineLimit(1)
                        }
                    }
                    Spacer()
                    MetaStatusBadge(status: ad.status)
                }
                MetaPerformanceGrid(spend: ad.spend, roas: ad.roas, purchases: ad.purchases, ctr: ad.ctr, impressions: ad.impressions, clicks: ad.clicks)
            }
        }
        .padding()
        .glassPanel(padding: 14, accent: ad.status == "ACTIVE" ? AppTheme.green : AppTheme.blue)
    }
}

struct MetaPerformanceGrid: View {
    let spend: Double
    let roas: Double?
    let purchases: Int
    let ctr: Double?
    let impressions: Int
    let clicks: Int

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            item("Gasto", String(format: "%.0f €", spend), AppTheme.red)
            item("ROAS", roas.map { String(format: "%.1fx", $0) } ?? "—", AppTheme.blue)
            item("Compras", "\(purchases)", AppTheme.green)
            item("CTR", ctr.map { String(format: "%.1f%%", $0) } ?? "—", AppTheme.amber)
            item("Impr.", compactNumber(impressions), AppTheme.ink)
            item("Clicks", compactNumber(clicks), AppTheme.ink)
        }
    }

    private func item(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.black))
                .foregroundStyle(AppTheme.muted)
            Text(value)
                .font(.footnote.weight(.heavy))
                .foregroundStyle(color)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(AppTheme.surfaceSoft.opacity(0.88), in: RoundedRectangle(cornerRadius: 10))
    }

    private func compactNumber(_ value: Int) -> String {
        if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
        if value >= 1_000 { return String(format: "%.1fk", Double(value) / 1_000) }
        return "\(value)"
    }
}

struct MetaCampaignRow: View {
    let campaign: MetaCampaign
    let busy: Bool
    let onToggle: () -> Void
    private var isActive: Bool { campaign.status == "ACTIVE" }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(campaign.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(2)
                    Text(campaign.objective ?? "—")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                Text(isActive ? "ACTIVA" : campaign.status)
                    .font(.caption2.weight(.heavy))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background((isActive ? AppTheme.green : AppTheme.muted).opacity(0.18), in: Capsule())
                    .foregroundStyle(isActive ? AppTheme.green : AppTheme.muted)
            }
            HStack(spacing: 14) {
                metric("Gasto", String(format: "%.0f €", campaign.spend))
                metric("ROAS", campaign.roas.map { String(format: "%.1fx", $0) } ?? "—")
                metric("Compras", "\(campaign.purchases)")
                metric("CTR", campaign.ctr.map { String(format: "%.1f%%", $0) } ?? "—")
            }
            Button(action: onToggle) {
                if busy {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Label(isActive ? "Pausar" : "Activar", systemImage: isActive ? "pause.fill" : "play.fill")
                        .font(.caption.weight(.bold))
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .tint(isActive ? AppTheme.amber : AppTheme.green)
            .disabled(busy)
        }
        .padding()
        .glassPanel(padding: 14, accent: isActive ? AppTheme.green : AppTheme.muted)
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(AppTheme.muted)
            Text(value).font(.footnote.weight(.heavy)).foregroundStyle(AppTheme.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MetaBestSellerRow: View {
    let rank: Int
    let seller: MetaBestSeller
    var body: some View {
        HStack(spacing: 12) {
            Text("\(rank)")
                .font(.headline.weight(.heavy))
                .foregroundStyle(AppTheme.blue)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(seller.title).font(.subheadline.weight(.bold)).foregroundStyle(AppTheme.ink).lineLimit(1)
                if let sku = seller.sku { Text(sku).font(.caption2).foregroundStyle(AppTheme.muted) }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(seller.quantity) ud").font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.green)
                Text(String(format: "%.0f €", seller.revenue)).font(.caption2.weight(.semibold)).foregroundStyle(AppTheme.muted)
            }
        }
        .padding(12)
        .glassPanel(padding: 12, accent: AppTheme.blue)
    }
}

struct MetaCreateAdSheet: View {
    @Environment(WorkshopStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onCreated: () -> Void

    @State private var name = ""
    @State private var templates: [MetaTemplate] = []
    @State private var selectedTemplate: String?
    @State private var dailyBudget = "5"
    @State private var message = ""
    @State private var headline = ""
    @State private var link = "https://speedwear.es"
    @State private var imageUrl = ""
    @State private var cta = "SHOP_NOW"
    @State private var loading = false
    @State private var creating = false
    @State private var error: String?
    @State private var result: MetaCreateCampaignResult?

    private let ctaOptions = ["SHOP_NOW", "LEARN_MORE", "BUY_NOW", "ORDER_NOW", "SIGN_UP"]

    var body: some View {
        NavigationStack {
            Form {
                if let result {
                    Section {
                        Label("Campaña creada en PAUSA", systemImage: "checkmark.seal.fill")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AppTheme.green)
                        Text(result.note).font(.footnote).foregroundStyle(AppTheme.muted)
                        Text("ID: \(result.campaignId)").font(.caption2).foregroundStyle(AppTheme.muted)
                    }
                } else {
                    Section("Plantilla (estructura a copiar)") {
                        if loading {
                            ProgressView()
                        } else {
                            Picker("Campaña base", selection: $selectedTemplate) {
                                Text("Sin plantilla (Ventas)").tag(String?.none)
                                ForEach(templates) { t in
                                    Text(t.name).tag(String?.some(t.id))
                                }
                            }
                        }
                    }
                    Section("Datos de la campaña") {
                        TextField("Nombre interno", text: $name)
                        HStack {
                            Text("Presupuesto/día (€)")
                            Spacer()
                            TextField("5", text: $dailyBudget)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 80)
                        }
                    }
                    Section("Creativo") {
                        TextField("Titular", text: $headline)
                        TextField("Texto del anuncio", text: $message, axis: .vertical).lineLimit(3...6)
                        TextField("URL destino", text: $link).keyboardType(.URL).autocapitalization(.none)
                        TextField("URL de la imagen", text: $imageUrl).keyboardType(.URL).autocapitalization(.none)
                        Picker("Botón", selection: $cta) {
                            ForEach(ctaOptions, id: \.self) { Text($0).tag($0) }
                        }
                    }
                    if let error {
                        Section { Text(error).font(.footnote).foregroundStyle(AppTheme.red) }
                    }
                    Section {
                        Button {
                            Task { await create() }
                        } label: {
                            if creating {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Label("Crear campaña (en pausa)", systemImage: "paperplane.fill")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .disabled(creating || !isValid)
                    }
                }
            }
            .navigationTitle("Nuevo anuncio")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "Cancelar" : "Cerrar") {
                        if result != nil { onCreated() }
                        dismiss()
                    }
                }
            }
            .task { await loadTemplates() }
        }
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
        && !message.trimmingCharacters(in: .whitespaces).isEmpty
        && !imageUrl.trimmingCharacters(in: .whitespaces).isEmpty
        && (Double(dailyBudget.replacingOccurrences(of: ",", with: ".")) ?? 0) > 0
    }

    private func loadTemplates() async {
        guard let client = store.apiClient else { return }
        loading = true
        defer { loading = false }
        templates = (try? await client.metaTemplates()) ?? []
    }

    private func create() async {
        guard let client = store.apiClient else { return }
        creating = true
        error = nil
        defer { creating = false }
        let budget = Double(dailyBudget.replacingOccurrences(of: ",", with: ".")) ?? 0
        let body = MetaCreateCampaignRequest(
            name: name,
            templateCampaignId: selectedTemplate,
            objective: nil,
            dailyBudget: budget,
            message: message,
            headline: headline.isEmpty ? nil : headline,
            description: nil,
            link: link,
            imageUrl: imageUrl,
            callToAction: cta,
            startTime: nil
        )
        do {
            result = try await client.metaCreateCampaign(body)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct EconomicsView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var today: EconomicsSummary?
    @State private var month: EconomicsSummary?
    @State private var custom: EconomicsSummary?
    @State private var products: [ProductMarginRow] = []
    @State private var loading = false
    @State private var error: String?
    @State private var range: Range = .today
    @State private var customFrom = Calendar.current.startOfDay(for: Date())
    @State private var customTo = Calendar.current.startOfDay(for: Date())

    enum Range: String, CaseIterable, Identifiable {
        case today, month, custom
        var id: String { rawValue }
        var label: String {
            switch self { case .today: "Hoy"; case .month: "Este mes"; case .custom: "Calendario" }
        }
    }

    var current: EconomicsSummary? {
        switch range { case .today: today; case .month: month; case .custom: custom }
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
                    .onChange(of: range) { _, newValue in
                        if newValue == .custom && custom == nil {
                            Task { await reloadCustomRange() }
                        }
                    }

                    if range == .custom {
                        CustomEconomicsDatePicker(
                            from: $customFrom,
                            to: $customTo,
                            loading: loading,
                            onApply: { Task { await reloadCustomRange() } }
                        )
                    }

                    if loading && current == nil {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let summary = current {
                        EconomicsHeroCard(summary: summary)
                        ReservasCard(summary: summary)
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
            async let c = client.economicsRange(from: customFrom, to: customTo)
            async let p = client.economicsProducts()
            today = try await t
            month = try await m
            custom = try await c
            products = try await p
        } catch let err {
            error = err.localizedDescription
        }
    }

    private func reloadCustomRange() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            custom = try await client.economicsRange(from: min(customFrom, customTo), to: max(customFrom, customTo))
        } catch let err {
            error = err.localizedDescription
        }
    }
}

struct CustomEconomicsDatePicker: View {
    @Binding var from: Date
    @Binding var to: Date
    let loading: Bool
    let onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Rango personalizado", systemImage: "calendar")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                Spacer()
                Button(action: sameDay) {
                    Label("Solo hoy", systemImage: "sun.max.fill")
                }
                .font(.caption.weight(.bold))
                .buttonStyle(.bordered)
            }

            DatePicker("Desde", selection: $from, displayedComponents: .date)
                .datePickerStyle(.compact)
            DatePicker("Hasta", selection: $to, displayedComponents: .date)
                .datePickerStyle(.compact)

            Button(action: onApply) {
                Label("Ver economía", systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(loading)
        }
        .glassPanel(padding: 14, accent: AppTheme.blue)
    }

    private func sameDay() {
        let today = Calendar.current.startOfDay(for: Date())
        from = today
        to = today
        onApply()
    }
}

struct BankView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var status: BankStatus?
    @State private var institutions: [BankInstitution] = []
    @State private var selectedInstitutionID: String?
    @State private var daily: BankDailySummary?
    @State private var allocation: AllocationPlan?
    @State private var selectedDay = Calendar.current.startOfDay(for: Date())
    @State private var loading = false
    @State private var error: String?
    @State private var info: String?

    private var selectedInstitution: BankInstitution? {
        institutions.first { $0.id == selectedInstitutionID } ?? institutions.first
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Banco")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Movimientos diarios para controlar caja real.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    BankConnectionCard(
                        status: status,
                        institutions: institutions,
                        selectedInstitutionID: $selectedInstitutionID,
                        loading: loading,
                        onConnect: { Task { await connectBank() } },
                        onRefreshBanks: { Task { await loadInstitutions() } }
                    )

                    if let allocation, !allocation.payouts.isEmpty {
                        BankAllocationSection(plan: allocation)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        DatePicker("Dia", selection: $selectedDay, displayedComponents: .date)
                            .datePickerStyle(.compact)
                        HStack(spacing: 10) {
                            Button { Task { await syncBank() } } label: {
                                Label("Sincronizar", systemImage: "arrow.triangle.2.circlepath")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(loading)

                            Button { Task { await loadDaily() } } label: {
                                Image(systemName: "arrow.clockwise")
                                    .frame(width: 44)
                            }
                            .buttonStyle(.bordered)
                            .disabled(loading)
                        }
                    }
                    .glassPanel(padding: 14, accent: AppTheme.blue)

                    if let daily {
                        BankDailyCard(summary: daily)
                        BankTransactionsSection(transactions: daily.transactions, currency: daily.currency)
                    } else if loading {
                        ProgressView().frame(maxWidth: .infinity)
                    }

                    if let info {
                        Text(info)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppTheme.green)
                            .padding(10)
                            .glassPanel(padding: 10, accent: AppTheme.green)
                    }

                    if let error {
                        Text(error)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AppTheme.red)
                            .padding(10)
                            .glassPanel(padding: 10, accent: AppTheme.red)
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Banco")
            .task { await reload() }
            .refreshable { await reload() }
        }
    }

    private func reload() async {
        await loadStatus()
        await loadInstitutions()
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadDaily() }
            group.addTask { await self.loadAllocation() }
        }
    }

    private func loadStatus() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        do { status = try await client.bankStatus() } catch { self.error = error.localizedDescription }
    }

    private func loadInstitutions() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        defer { loading = false }
        do {
            institutions = try await client.bankInstitutions()
            if selectedInstitutionID == nil {
                selectedInstitutionID = institutions.first(where: { $0.name.localizedCaseInsensitiveContains("N26") })?.id ?? institutions.first?.id
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func connectBank() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        guard let institution = selectedInstitution else { error = "No hay banco seleccionado"; return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let connection = try await client.bankConnect(institutionId: institution.id, institutionName: institution.name)
            if let link = connection.link, let url = URL(string: link) {
                await MainActor.run { UIApplication.shared.open(url) }
                info = "Autoriza el banco y vuelve a la app. Luego pulsa Sincronizar."
            } else {
                info = "Conexion creada. Pulsa Sincronizar cuando el banco este autorizado."
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func syncBank() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let response = try await client.bankSync(from: selectedDay, to: selectedDay)
            info = "Sincronizados \(response.imported) movimientos de \(response.accounts) cuenta(s)."
            await loadDaily()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadDaily() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        do {
            daily = try await client.bankDaily(from: selectedDay, to: selectedDay)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadAllocation() async {
        guard let client = store.apiClient else { return }
        do {
            allocation = try await client.bankAllocation()
        } catch {
            // silent — allocation is optional context
        }
    }
}

// MARK: - Devoluciones

struct DevolucionesView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var returns: [ReturnRecord] = []
    @State private var loading = false
    @State private var error: String?
    @State private var scannerActive = false
    @State private var scannedReturn: ReturnRecord?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        Button {
                            scannerActive = true
                        } label: {
                            Label("Escanear etiqueta", systemImage: "barcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.teal)
                        .controlSize(.large)
                    }
                    .glassPanel(padding: 12)

                    let pending  = returns.filter { $0.status == "LABEL_CREATED" }
                    let received = returns.filter { $0.status == "RECEIVED" }
                    let done     = returns.filter { ["APPROVED", "REJECTED"].contains($0.status) }

                    if !pending.isEmpty {
                        SectionHeader(title: "En camino", subtitle: "\(pending.count) en tránsito")
                        ForEach(pending) { ret in
                            NavigationLink(value: ret) { DevolucionRow(ret: ret) }.buttonStyle(.plain)
                        }
                    }

                    if !received.isEmpty {
                        SectionHeader(title: "Recibidas — pendiente verificar", subtitle: "\(received.count) esperando revisión")
                        ForEach(received) { ret in
                            NavigationLink(value: ret) { DevolucionRow(ret: ret) }.buttonStyle(.plain)
                        }
                    }

                    if !done.isEmpty {
                        SectionHeader(title: "Completadas", subtitle: "\(done.count) procesadas")
                        ForEach(done) { ret in
                            NavigationLink(value: ret) { DevolucionRow(ret: ret) }.buttonStyle(.plain)
                        }
                    }

                    if returns.isEmpty && !loading {
                        ContentUnavailableView("Sin devoluciones", systemImage: "arrow.uturn.left.circle", description: Text("No hay devoluciones registradas."))
                            .glassPanel()
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
            .navigationTitle("Devoluciones")
            .toolbar {
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.disabled(loading)
            }
            .task { await load() }
            .refreshable { await load() }
            .navigationDestination(for: ReturnRecord.self) { ret in
                DevolucionDetailView(ret: ret, onUpdate: { updated in
                    if let idx = returns.firstIndex(where: { $0.id == updated.id }) {
                        returns[idx] = updated
                    }
                })
            }
            .fullScreenCover(isPresented: $scannerActive) {
                ReturnScannerView { tracking in
                    scannerActive = false
                    Task { await lookupTracking(tracking) }
                }
            }
            .sheet(item: $scannedReturn) { ret in
                NavigationStack {
                    DevolucionDetailView(ret: ret, onUpdate: { updated in
                        scannedReturn = updated
                        if let idx = returns.firstIndex(where: { $0.id == updated.id }) {
                            returns[idx] = updated
                        }
                    })
                }
            }
        }
    }

    private func load() async {
        guard let client = store.apiClient else { return }
        loading = true; defer { loading = false }
        error = nil
        do { returns = try await client.listReturns() }
        catch let err { error = err.localizedDescription }
    }

    private func lookupTracking(_ tracking: String) async {
        guard let client = store.apiClient else { return }
        do {
            let ret = try await client.returnByTracking(tracking)
            scannedReturn = ret
            if let idx = returns.firstIndex(where: { $0.id == ret.id }) {
                returns[idx] = ret
            } else {
                returns.insert(ret, at: 0)
            }
        } catch {
            self.error = "No encontrada: \(tracking)"
        }
    }
}

struct DevolucionRow: View {
    let ret: ReturnRecord
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(ret.shopifyOrderNumber)
                    .font(.headline.weight(.heavy)).foregroundStyle(AppTheme.ink)
                Text(ret.customerName)
                    .font(.caption).foregroundStyle(AppTheme.muted).lineLimit(1)
                if let tracking = ret.trackingNumber {
                    Label(tracking, systemImage: "barcode")
                        .font(.caption2.weight(.bold)).foregroundStyle(AppTheme.teal).lineLimit(1)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                ReturnStatusBadge(status: ret.status)
                Text("\(ret.items.count) art.")
                    .font(.caption2).foregroundStyle(AppTheme.muted)
            }
        }
        .glassPanel(padding: 12)
    }
}

struct ReturnStatusBadge: View {
    let status: String
    var body: some View {
        let (label, color): (String, Color) = {
            switch status {
            case "LABEL_CREATED": return ("EN CAMINO", AppTheme.blue)
            case "RECEIVED": return ("RECIBIDA", AppTheme.amber)
            case "APPROVED": return ("APROBADA", AppTheme.green)
            case "REJECTED": return ("RECHAZADA", AppTheme.red)
            case "REQUESTED": return ("SOLICITADA", AppTheme.muted)
            default: return (status.replacingOccurrences(of: "_", with: " "), AppTheme.muted)
            }
        }()
        return Text(label)
            .font(.caption2.weight(.black))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(color.opacity(0.3)))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct DevolucionDetailView: View {
    @Environment(WorkshopStore.self) private var store
    let ret: ReturnRecord
    let onUpdate: (ReturnRecord) -> Void
    @State private var loading = false
    @State private var error: String?
    @State private var showingDenySheet = false
    @State private var denyNotes = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(ret.shopifyOrderNumber)
                            .font(.system(size: 28, weight: .black)).foregroundStyle(AppTheme.ink)
                        Spacer()
                        ReturnStatusBadge(status: ret.status)
                    }
                    Text(ret.customerName)
                        .font(.subheadline.weight(.medium)).foregroundStyle(AppTheme.muted)
                    if let tracking = ret.trackingNumber {
                        Label(tracking, systemImage: "barcode.viewfinder")
                            .font(.caption.weight(.bold)).foregroundStyle(AppTheme.teal)
                    }
                }
                .glassPanel(padding: 16)

                // Resumen financiero
                HStack(spacing: 0) {
                    VStack(spacing: 2) {
                        Text("Reembolso").font(.caption2).foregroundStyle(AppTheme.muted)
                        Text(ret.refundAmount, format: .currency(code: "EUR"))
                            .font(.title2.weight(.black)).foregroundStyle(AppTheme.green)
                    }
                    .frame(maxWidth: .infinity)
                    if ret.totalAmount > 0 {
                        Divider().frame(height: 36)
                        VStack(spacing: 2) {
                            Text("Etiqueta").font(.caption2).foregroundStyle(AppTheme.muted)
                            Text(ret.totalAmount, format: .currency(code: "EUR"))
                                .font(.title2.weight(.black)).foregroundStyle(AppTheme.amber)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .glassPanel(padding: 12)

                // Etiqueta de devolución
                if let labelUrlStr = ret.labelUrl, let labelURL = URL(string: labelUrlStr) {
                    Link(destination: labelURL) {
                        Label("Ver etiqueta de devolución", systemImage: "doc.richtext.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.blue)
                    .controlSize(.large)
                }

                // Items
                SectionHeader(title: "Artículos a devolver", subtitle: "\(ret.items.reduce(0) { $0 + $1.quantity }) unidades")
                VStack(spacing: 8) {
                    ForEach(ret.items) { item in
                        HStack(spacing: 10) {
                            if let imgStr = item.imageUrl, let imgURL = URL(string: imgStr) {
                                AsyncImage(url: imgURL) { phase in
                                    switch phase {
                                    case .success(let img):
                                        img.resizable().scaledToFill()
                                            .frame(width: 56, height: 56).clipped().clipShape(RoundedRectangle(cornerRadius: 8))
                                    default:
                                        RoundedRectangle(cornerRadius: 8).fill(AppTheme.surfaceSoft)
                                            .frame(width: 56, height: 56)
                                            .overlay(Image(systemName: "tshirt.fill").foregroundStyle(AppTheme.mutedSoft))
                                    }
                                }
                            } else {
                                RoundedRectangle(cornerRadius: 8).fill(AppTheme.surfaceSoft)
                                    .frame(width: 56, height: 56)
                                    .overlay(Image(systemName: "tshirt.fill").foregroundStyle(AppTheme.mutedSoft))
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).font(.subheadline.weight(.semibold)).foregroundStyle(AppTheme.ink).lineLimit(2)
                                if let variant = item.variantTitle { Text(variant).font(.caption).foregroundStyle(AppTheme.muted) }
                                Text(reasonLabel(item.reason)).font(.caption2).foregroundStyle(AppTheme.amber)
                            }
                            Spacer()
                            Text("×\(item.quantity)").font(.title3.weight(.black)).foregroundStyle(AppTheme.ink)
                        }
                        .padding(10).glassPanel(padding: 0)
                    }
                }

                // Actions
                if ret.status == "LABEL_CREATED" {
                    Button {
                        Task { await markReceived() }
                    } label: {
                        if loading { ProgressView().frame(maxWidth: .infinity) }
                        else { Label("Marcar como recibida", systemImage: "checkmark.circle.fill").frame(maxWidth: .infinity) }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.teal)
                    .controlSize(.large)
                    .disabled(loading)
                }

                if ret.status == "RECEIVED" {
                    HStack(spacing: 12) {
                        Button {
                            Task { await verify(status: "OK", notes: nil) }
                        } label: {
                            if loading { ProgressView().frame(maxWidth: .infinity) }
                            else { Label("Aprobar", systemImage: "checkmark.seal.fill").frame(maxWidth: .infinity) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.green)
                        .controlSize(.large)
                        .disabled(loading)

                        Button {
                            showingDenySheet = true
                        } label: {
                            Label("Problema", systemImage: "xmark.circle.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(AppTheme.red)
                        .controlSize(.large)
                        .disabled(loading)
                    }
                    .glassPanel(padding: 12)
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
        .navigationTitle(ret.shopifyOrderNumber)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingDenySheet) {
            NavigationStack {
                VStack(alignment: .leading, spacing: 16) {
                    Text("¿Cuál es el problema?").font(.headline).foregroundStyle(AppTheme.ink)
                    TextEditor(text: $denyNotes)
                        .frame(minHeight: 100)
                        .padding(8)
                        .glassPanel(padding: 0)
                    Button {
                        showingDenySheet = false
                        Task { await verify(status: "ISSUE", notes: denyNotes.isEmpty ? nil : denyNotes) }
                    } label: {
                        Label("Confirmar problema", systemImage: "xmark.circle.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(AppTheme.red)
                    .controlSize(.large)
                    Spacer()
                }
                .padding()
                .screenBackground()
                .navigationTitle("Rechazar devolución")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    Button("Cancelar") { showingDenySheet = false }
                }
            }
        }
    }

    private func markReceived() async {
        guard let client = store.apiClient else { return }
        loading = true; defer { loading = false }
        error = nil
        do { let updated = try await client.markReturnReceived(ret.id); onUpdate(updated) }
        catch let err { error = err.localizedDescription }
    }

    private func verify(status: String, notes: String?) async {
        guard let client = store.apiClient else { return }
        loading = true; defer { loading = false }
        error = nil
        do { let updated = try await client.verifyReturn(ret.id, status: status, notes: notes); onUpdate(updated) }
        catch let err { error = err.localizedDescription }
    }

    private func reasonLabel(_ reason: String) -> String {
        switch reason {
        case "NOT_AS_DESCRIBED": return "No es como se describe"
        case "WRONG_SIZE": return "Talla incorrecta"
        case "DEFECTIVE": return "Defectuoso"
        case "CHANGED_MIND": return "Cambio de opinión"
        case "EXCHANGE": return "Cambio de producto"
        default: return reason.replacingOccurrences(of: "_", with: " ")
        }
    }
}

struct ReturnScannerView: View {
    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            BarcodeScannerView(capturesPhoto: false, continuous: false) { code, _ in
                onScan(code)
            }
            .ignoresSafeArea()
            .navigationTitle("Escanear etiqueta devolución")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                Button("Cancelar") { dismiss() }
            }
        }
    }
}

extension ReturnRecord: Hashable {
    static func == (lhs: ReturnRecord, rhs: ReturnRecord) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct CashflowView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var summary: CashflowSummary?
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Caja")
                            .font(.system(size: 30, weight: .heavy, design: .rounded))
                            .foregroundStyle(AppTheme.ink)
                        Text("Cobros de Shopify y qué separar cada día.")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppTheme.muted)
                    }

                    if loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                    } else if let summary {
                        CashflowTodayCard(summary: summary, onToggleMark: { payout in await toggleMark(payout) })
                        if !summary.pending.payouts.isEmpty || !summary.scheduled.payouts.isEmpty {
                            CashflowPendingCard(pending: summary.pending, scheduled: summary.scheduled, currency: summary.currency)
                        }
                    } else if let error {
                        Text(error).font(.footnote).foregroundStyle(AppTheme.red).glassPanel(padding: 12, accent: AppTheme.red)
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Caja")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        guard let client = store.apiClient else { error = "API no configurada"; return }
        loading = true
        defer { loading = false }
        do { summary = try await client.cashflow() }
        catch { self.error = error.localizedDescription }
    }

    private func toggleMark(_ payout: CashflowPayout) async {
        guard let client = store.apiClient else { return }
        do {
            if payout.marked { try await client.unmarkPayout(payout.id) }
            else { try await client.markPayout(payout.id) }
            summary = try await client.cashflow()
        } catch { self.error = error.localizedDescription }
    }
}

struct CashflowTodayCard: View {
    let summary: CashflowSummary
    let onToggleMark: (CashflowPayout) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Cobrado hoy")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                    Text(formatted(summary.receivedToday, currency: summary.currency))
                        .font(.system(size: 36, weight: .heavy, design: .rounded))
                        .foregroundStyle(summary.receivedToday > 0 ? AppTheme.green : AppTheme.muted)
                }
                Spacer()
                Image(systemName: summary.receivedToday > 0 ? "checkmark.circle.fill" : "clock.circle")
                    .font(.system(size: 32))
                    .foregroundStyle(summary.receivedToday > 0 ? AppTheme.green : AppTheme.muted)
            }

            if summary.payouts.isEmpty {
                Text("Hoy no ha entrado ningún pago de Shopify.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.muted)
            } else {
                Divider().background(AppTheme.line)
                ForEach(summary.payouts) { payout in
                    CashflowPayoutDetail(payout: payout, currency: summary.currency, onToggleMark: onToggleMark)
                }
            }

            if summary.receivedToday > 0 {
                Divider().background(AppTheme.line)
                Text("Qué separar ahora")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(AppTheme.ink)
                CashflowAllocationGrid(allocation: summary.allocation, currency: summary.currency)
            }
        }
        .glassPanel(padding: 16, accent: AppTheme.green)
    }

    private func formatted(_ value: Double, currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

struct CashflowPayoutDetail: View {
    let payout: CashflowPayout
    let currency: String
    let onToggleMark: (CashflowPayout) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                Task { await onToggleMark(payout) }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: payout.marked ? "checkmark.circle.fill" : "circle")
                        .font(.title3)
                        .foregroundStyle(payout.marked ? AppTheme.green : AppTheme.muted)
                    Text(payout.marked ? "Dinero separado" : "Marcar como separado")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(payout.marked ? AppTheme.green : AppTheme.muted)
                    Spacer()
                }
            }
            .buttonStyle(.plain)

            // Group by sale date
            ForEach(payout.salesDays) { day in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: "calendar")
                            .font(.caption)
                            .foregroundStyle(AppTheme.teal)
                        Text("Ventas del \(day.date)")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.teal)
                        Spacer()
                        Text(m(day.subtotal, currency: currency))
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AppTheme.teal)
                    }
                    ForEach(Array(day.orders.enumerated()), id: \.offset) { _, order in
                        HStack {
                            Image(systemName: "cart.fill")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.muted)
                            Text(order.orderNumber ?? "Pedido sin número")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AppTheme.ink)
                            Spacer()
                            Text(m(order.amount, currency: currency))
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(AppTheme.inkSoft)
                        }
                        .padding(.leading, 12)
                    }
                }
            }

            HStack {
                Image(systemName: "percent")
                    .font(.caption2)
                    .foregroundStyle(AppTheme.red)
                Text("Comisión Shopify")
                    .font(.caption)
                    .foregroundStyle(AppTheme.muted)
                Spacer()
                Text(m(payout.shopifyFee, currency: currency))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.red)
            }

            if payout.refunds != 0 {
                HStack {
                    Image(systemName: "arrow.uturn.left")
                        .font(.caption2)
                        .foregroundStyle(AppTheme.red)
                    Text("Devolución")
                        .font(.caption)
                        .foregroundStyle(AppTheme.red)
                    Spacer()
                    Text(m(payout.refunds, currency: currency))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.red)
                }
            }
        }
    }

    private func m(_ value: Double, currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

struct CashflowAllocationGrid: View {
    let allocation: CashflowAllocation
    let currency: String

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            CashflowAllocationTile(label: "Hacienda / IVA", amount: allocation.taxReserve, currency: currency, color: AppTheme.red, icon: "building.columns.fill")
            CashflowAllocationTile(label: "Producción", amount: allocation.production, currency: currency, color: AppTheme.amber, icon: "tshirt.fill")
            CashflowAllocationTile(label: "Envíos", amount: allocation.shipping, currency: currency, color: AppTheme.blue, icon: "shippingbox.fill")
            CashflowAllocationTile(label: "Beneficio libre", amount: allocation.cashFree, currency: currency, color: AppTheme.green, icon: "banknote.fill")
        }
    }
}

struct CashflowAllocationTile: View {
    let label: String
    let amount: Double
    let currency: String
    let color: Color
    let icon: String

    private var formatted: String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon).font(.caption).foregroundStyle(color)
                Spacer()
            }
            Text(formatted)
                .font(.title3.weight(.heavy))
                .foregroundStyle(color)
            Text(label)
                .font(.caption.weight(.medium))
                .foregroundStyle(AppTheme.muted)
                .lineLimit(1)
        }
        .padding(12)
        .background(color.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct CashflowPendingCard: View {
    let pending: CashflowPending
    let scheduled: CashflowPending
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Pendiente de cobrar")
                .font(.headline.weight(.bold))
                .foregroundStyle(AppTheme.ink)

            if pending.amount > 0 {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("En tránsito")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                        Spacer()
                        Text(m(pending.amount))
                            .font(.title2.weight(.heavy))
                            .foregroundStyle(AppTheme.amber)
                    }
                    ForEach(pending.payouts) { payout in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("Ingreso \(payout.date)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(AppTheme.ink)
                                Spacer()
                                Text(m(payout.amount))
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(AppTheme.amber)
                            }
                            ForEach(payout.salesDays) { day in
                                HStack {
                                    Image(systemName: "calendar")
                                        .font(.caption2)
                                        .foregroundStyle(AppTheme.teal)
                                    Text("Ventas del \(day.date) · \(day.orders.count) pedidos")
                                        .font(.caption)
                                        .foregroundStyle(AppTheme.teal)
                                    Spacer()
                                    Text(m(day.subtotal))
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(AppTheme.teal)
                                }
                                .padding(.leading, 8)
                            }
                        }
                        .padding(10)
                        .background(AppTheme.amber.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }

            if scheduled.amount > 0 {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("Programado")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                        Spacer()
                        Text(m(scheduled.amount))
                            .font(.title2.weight(.heavy))
                            .foregroundStyle(AppTheme.purple)
                    }
                    ForEach(scheduled.payouts) { payout in
                        HStack {
                            Text("Ingreso \(payout.date)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AppTheme.ink)
                            Spacer()
                            Text(m(payout.amount))
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(AppTheme.purple)
                        }
                    }
                }
            }
        }
        .glassPanel(padding: 16, accent: AppTheme.amber)
    }

    private func m(_ value: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

struct BankAllocationSection: View {
    let plan: AllocationPlan

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reparto de ingresos")
                .font(.headline.weight(.bold))
                .foregroundStyle(AppTheme.ink)

            ForEach(plan.payouts) { payout in
                PayoutAllocationCard(payout: payout, currency: plan.currency)
            }
        }
    }
}

struct PayoutAllocationCard: View {
    let payout: PayoutAllocation
    let currency: String

    private var fmt: NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f
    }

    private func money(_ value: Double) -> String {
        fmt.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(payout.date)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.muted)
                    Text(payout.description)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.ink)
                        .lineLimit(1)
                }
                Spacer()
                Text(money(payout.totalAmount))
                    .font(.title3.weight(.heavy))
                    .foregroundStyle(AppTheme.green)
            }

            AllocationBar(allocation: payout.allocation, total: payout.totalAmount)

            VStack(spacing: 6) {
                AllocationRow(label: "Hacienda / IVA", amount: payout.allocation.taxReserve, currency: currency, color: AppTheme.red)
                AllocationRow(label: "Producción", amount: payout.allocation.production, currency: currency, color: AppTheme.amber)
                AllocationRow(label: "Envíos", amount: payout.allocation.shipping, currency: currency, color: AppTheme.blue)
                AllocationRow(label: "Beneficio libre", amount: payout.allocation.cashFree, currency: currency, color: AppTheme.green)
            }
        }
        .glassPanel(padding: 14, accent: AppTheme.green)
    }
}

struct AllocationBar: View {
    let allocation: AllocationBreakdown
    let total: Double

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 2) {
                let taxW = geo.size.width * (allocation.taxReserve / total)
                let prodW = geo.size.width * (allocation.production / total)
                let shipW = geo.size.width * (allocation.shipping / total)
                let freeW = geo.size.width * max(0, allocation.cashFree / total)
                RoundedRectangle(cornerRadius: 3).fill(AppTheme.red).frame(width: taxW)
                RoundedRectangle(cornerRadius: 3).fill(AppTheme.amber).frame(width: prodW)
                RoundedRectangle(cornerRadius: 3).fill(AppTheme.blue).frame(width: shipW)
                RoundedRectangle(cornerRadius: 3).fill(AppTheme.green).frame(width: freeW)
            }
        }
        .frame(height: 8)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

struct AllocationRow: View {
    let label: String
    let amount: Double
    let currency: String
    let color: Color

    private var formatted: String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = currency
        f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    var body: some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(AppTheme.ink)
            Spacer()
            Text(formatted)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(color)
        }
    }
}

struct BankConnectionCard: View {
    let status: BankStatus?
    let institutions: [BankInstitution]
    @Binding var selectedInstitutionID: String?
    let loading: Bool
    let onConnect: () -> Void
    let onRefreshBanks: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(status?.configured == true ? "PSD2 listo" : "PSD2 en modo demo", systemImage: "lock.shield.fill")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(status?.configured == true ? AppTheme.green : AppTheme.amber)
                Spacer()
                Button(action: onRefreshBanks) {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(loading)
            }

            Picker("Banco", selection: Binding(
                get: { selectedInstitutionID ?? institutions.first?.id ?? "" },
                set: { selectedInstitutionID = $0 }
            )) {
                ForEach(institutions) { bank in
                    Text(bank.name).tag(bank.id)
                }
            }
            .pickerStyle(.menu)

            Button(action: onConnect) {
                Label("Conectar banco", systemImage: "building.columns.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(loading || institutions.isEmpty)

            Text("Nunca guardamos usuario ni contraseña del banco. La autorizacion ocurre en la pagina del banco.")
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .glassPanel(padding: 16, accent: status?.configured == true ? AppTheme.green : AppTheme.amber)
    }
}

struct BankDailyCard: View {
    let summary: BankDailySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                MoneyTile(label: "Ingresos", value: summary.income, currency: summary.currency, color: AppTheme.green)
                MoneyTile(label: "Gastos", value: summary.expense, currency: summary.currency, color: AppTheme.red)
                MoneyTile(label: "Neto banco", value: summary.net, currency: summary.currency, color: summary.net >= 0 ? AppTheme.blue : AppTheme.red)
            }
            Text("\(summary.count) movimientos bancarios")
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
        }
        .glassPanel(padding: 16, accent: summary.net >= 0 ? AppTheme.green : AppTheme.red)
    }
}

struct BankTransactionsSection: View {
    let transactions: [BankTransaction]
    let currency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Movimientos", subtitle: "Clasificados automaticamente")
            if transactions.isEmpty {
                EmptyStateCard(title: "Sin movimientos", subtitle: "Sincroniza el banco o elige otro dia.")
            } else {
                ForEach(transactions) { transaction in
                    BankTransactionRow(transaction: transaction, currency: currency)
                }
            }
        }
    }
}

struct BankTransactionRow: View {
    let transaction: BankTransaction
    let currency: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: transaction.amount >= 0 ? "arrow.down.circle.fill" : "arrow.up.circle.fill")
                .font(.title3)
                .foregroundStyle(transaction.amount >= 0 ? AppTheme.green : AppTheme.red)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.counterpartyName ?? transaction.description)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(2)
                Text(bankCategoryText(transaction.category))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
                if let order = transaction.orderNumber {
                    Tag(text: order, systemImage: "cart.fill")
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(formatMoney(transaction.amount, currency: transaction.currency))
                    .font(.headline.weight(.black))
                    .foregroundStyle(transaction.amount >= 0 ? AppTheme.green : AppTheme.red)
                Text(formatPayoutLineDate(transaction.bookingDate))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(12)
        .background(AppTheme.surfaceSoft)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct EmptyStateCard: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.headline.weight(.heavy))
                .foregroundStyle(AppTheme.ink)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(AppTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(padding: 14, accent: AppTheme.blue)
    }
}

struct ShopifyPayoutsCard: View {
    let summary: ShopifyPayoutsSummary
    @State private var expandedPayoutID: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Pagos Shopify")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text("Ingresos previstos y margen estimado por pedido.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(formatMoney(summary.totalAmount, currency: summary.currency))
                        .font(.title3.weight(.black))
                        .foregroundStyle(AppTheme.green)
                    Text("\(summary.payoutCount) pagos")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                }
            }

            HStack(spacing: 10) {
                MoneyTile(label: "Cargos", value: summary.totalCharges, currency: summary.currency, color: AppTheme.blue)
                MoneyTile(label: "Comisiones", value: summary.totalFees, currency: summary.currency, color: AppTheme.red)
                MoneyTile(label: "Margen", value: summary.totalEstimatedMargin, currency: summary.currency, color: summary.totalEstimatedMargin >= 0 ? AppTheme.green : AppTheme.red)
            }

            VStack(spacing: 10) {
                ForEach(summary.payouts.prefix(5)) { payout in
                    ShopifyPayoutRow(
                        payout: payout,
                        isExpanded: expandedPayoutID == payout.id,
                        onToggle: {
                            withAnimation(.snappy) {
                                expandedPayoutID = expandedPayoutID == payout.id ? nil : payout.id
                            }
                        }
                    )
                }
            }
        }
        .glassPanel(padding: 16, accent: AppTheme.green)
    }
}

struct ShopifyPayoutRow: View {
    let payout: ShopifyPayout
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onToggle) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            Text(formatPayoutDate(payout.date))
                                .font(.subheadline.weight(.heavy))
                                .foregroundStyle(AppTheme.ink)
                            Tag(text: payoutStatusText(payout.status), systemImage: "clock.fill")
                        }
                        Text("\(payout.lines.count) movimientos · margen \(formatMoneyShort(payout.estimatedMargin))")
                            .font(.caption)
                            .foregroundStyle(AppTheme.muted)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatMoney(payout.amount, currency: payout.currency))
                            .font(.headline.weight(.black))
                            .foregroundStyle(AppTheme.green)
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Tag(text: "Cargos \(formatMoneyShort(payout.charges))", systemImage: "plus.circle.fill")
                Tag(text: "Fees \(formatMoneyShort(payout.fees))", systemImage: "minus.circle.fill")
                Tag(text: "Reemb \(formatMoneyShort(payout.refunds))", systemImage: "arrow.uturn.backward.circle.fill")
            }

            if isExpanded {
                VStack(spacing: 8) {
                    ForEach(payout.lines.prefix(8)) { line in
                        ShopifyPayoutLineRow(line: line)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(12)
        .background(AppTheme.surfaceSoft)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct ShopifyPayoutLineRow: View {
    let line: ShopifyPayoutLine

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.orderNumber ?? line.type.capitalized)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                Text("\(formatPayoutLineDate(line.processedAt)) · \(payoutTypeText(line.type))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(AppTheme.muted)
                if let margin = line.margin {
                    Text("Margen app \(formatMoneyShort(margin))")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(margin >= 0 ? AppTheme.green : AppTheme.red)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(formatMoney(line.net, currency: line.currency))
                    .font(.subheadline.weight(.black))
                    .foregroundStyle(line.net >= 0 ? AppTheme.green : AppTheme.red)
                Text("fee \(formatMoneyShort(line.fee))")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
            }
        }
        .padding(10)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct EconomicsHeroCard: View {
    let summary: EconomicsSummary
    private var color: Color {
        switch summary.cashStatus {
        case "HEALTHY": AppTheme.green
        case "WATCH": AppTheme.amber
        default: AppTheme.red
        }
    }
    private var statusTitle: String {
        switch summary.cashStatus {
        case "HEALTHY": "Caja sana"
        case "WATCH": "Caja justa"
        default: "No retirar"
        }
    }
    private var statusMessage: String {
        switch summary.cashStatus {
        case "HEALTHY": "Puedes tocar la caja libre; costes y reservas cubiertos."
        case "WATCH": "Aparta primero las reservas. Sé prudente."
        default: "No retires: primero cubre costes y reservas."
        }
    }
    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                MoneyTile(label: "Ingresos", value: summary.grossRevenue, currency: summary.currency, color: AppTheme.blue)
                MoneyTile(label: "Margen", value: summary.netMargin, currency: summary.currency, color: summary.netMargin >= 0 ? AppTheme.ink : AppTheme.red)
                MoneyTile(label: "Caja libre", value: summary.cashFree, currency: summary.currency, color: color)
            }
            Divider().background(AppTheme.line)
            HStack(spacing: 8) {
                Image(systemName: summary.cashStatus == "HEALTHY" ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(statusTitle).font(.subheadline.weight(.heavy)).foregroundStyle(color)
                    Text(statusMessage).font(.caption2).foregroundStyle(AppTheme.muted)
                }
                Spacer()
                if let pct = summary.netMarginPct {
                    Text(String(format: "%.0f%%", pct))
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(pct >= 0 ? AppTheme.green : AppTheme.red)
                }
            }
        }
        .glassPanel(padding: 16, accent: color)
    }
}

struct ReservasCard: View {
    let summary: EconomicsSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Apartar", systemImage: "lock.fill").font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.ink)
                Spacer()
                Text(formatMoney(summary.cashOut, currency: summary.currency))
                    .font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(AppTheme.amber)
            }
            Divider().background(AppTheme.line)
            VStack(spacing: 8) {
                ReserveLine(label: "Coste producto + merma", value: summary.replacementReserve, currency: summary.currency, color: AppTheme.blue)
                ReserveLine(label: "Envíos", value: summary.shippingCost, currency: summary.currency, color: AppTheme.amber)
                ReserveLine(label: "Comisiones Shopify", value: summary.shopifyFee, currency: summary.currency, color: AppTheme.purple)
                ReserveLine(label: "Reserva fiscal \(Int((summary.taxReserveRate * 100).rounded()))%", value: summary.taxReserve, currency: summary.currency, color: AppTheme.red)
                if let ad = summary.adSpend, ad > 0 {
                    ReserveLine(label: "Gasto Meta Ads", value: ad, currency: summary.currency, color: AppTheme.amber)
                }
            }
            if let reserve = summary.adsReserve, reserve > 0 {
                HStack(spacing: 8) {
                    Image(systemName: "megaphone.fill").foregroundStyle(AppTheme.amber)
                    Text("Saldo Meta pendiente de cobro").font(.caption.weight(.semibold)).foregroundStyle(AppTheme.muted)
                    Spacer()
                    Text(formatMoney(reserve, currency: summary.currency)).font(.subheadline.weight(.heavy)).foregroundStyle(AppTheme.amber)
                }
                .padding(10)
                .background(AppTheme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .glassPanel(padding: 16, accent: AppTheme.amber)
    }
}

struct CashFlowHealthCard: View {
    let summary: EconomicsSummary

    private var color: Color {
        switch summary.cashStatus {
        case "HEALTHY": AppTheme.green
        case "WATCH": AppTheme.amber
        default: AppTheme.red
        }
    }

    private var title: String {
        switch summary.cashStatus {
        case "HEALTHY": "Caja sana"
        case "WATCH": "Caja justa"
        default: "No retirar"
        }
    }

    private var message: String {
        switch summary.cashStatus {
        case "HEALTHY": "Puedes tocar la caja libre dejando cubiertos envios, reposicion, merma, comisiones e impuestos."
        case "WATCH": "Aparta primero las reservas. La caja libre existe, pero conviene ser prudente."
        default: "No retires dinero de este rango: primero hay que cubrir costes y reservas."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 5) {
                    Label(title, systemImage: summary.cashStatus == "HEALTHY" ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(color)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                Text(formatMoney(summary.cashFree, currency: summary.currency))
                    .font(.system(size: 28, weight: .heavy, design: .rounded))
                    .foregroundStyle(color)
            }

            HStack(spacing: 10) {
                MoneyTile(label: "Entra", value: summary.grossRevenue, currency: summary.currency, color: AppTheme.blue)
                MoneyTile(label: "Apartar", value: summary.cashOut, currency: summary.currency, color: AppTheme.amber)
                MoneyTile(label: "Libre", value: summary.cashFree, currency: summary.currency, color: color)
            }

            VStack(spacing: 8) {
                ReserveLine(label: "Reposicion", value: summary.replacementReserve, currency: summary.currency, color: AppTheme.blue)
                ReserveLine(label: "Envios", value: summary.shippingCost, currency: summary.currency, color: AppTheme.amber)
                ReserveLine(label: "Comisiones", value: summary.shopifyFee, currency: summary.currency, color: AppTheme.purple)
                ReserveLine(label: "Reserva fiscal \(Int((summary.taxReserveRate * 100).rounded()))%", value: summary.taxReserve, currency: summary.currency, color: AppTheme.red)
            }
        }
        .glassPanel(padding: 16, accent: color)
    }
}

struct ReserveLine: View {
    let label: String
    let value: Double
    let currency: String
    let color: Color

    var body: some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
                .font(.caption.weight(.bold))
                .foregroundStyle(AppTheme.muted)
            Spacer()
            Text(formatMoney(value, currency: currency))
                .font(.caption.weight(.heavy))
                .foregroundStyle(AppTheme.ink)
        }
        .padding(.vertical, 2)
    }
}

struct AllocationPlanCard: View {
    let summary: EconomicsSummary

    private var totalCost: Double {
        summary.cashOut
    }

    private func percent(_ value: Double) -> Double {
        guard summary.grossRevenue > 0 else { return 0 }
        return value / summary.grossRevenue * 100
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Reparto definitivo")
                        .font(.headline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    Text("Calculado con costes reales/estimados. Embalaje 0 EUR y mano de obra fuera.")
                        .font(.caption)
                        .foregroundStyle(AppTheme.muted)
                }
                Spacer()
                Text(summary.netMarginPct.map { "\(Int($0.rounded()))%" } ?? "0%")
                    .font(.headline.weight(.black))
                    .foregroundStyle(summary.netMargin >= 0 ? AppTheme.green : AppTheme.red)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(summary.netMargin >= 0 ? AppTheme.green.opacity(0.12) : AppTheme.red.opacity(0.12))
                    .clipShape(Capsule())
            }

            VStack(spacing: 12) {
                AllocationValueRow(
                    title: "Envíos",
                    icon: "shippingbox.fill",
                    color: AppTheme.amber,
                    percent: percent(summary.shippingCost),
                    amount: summary.shippingCost,
                    currency: summary.currency
                )
                AllocationValueRow(
                    title: "Materia prima",
                    icon: "tshirt.fill",
                    color: AppTheme.blue,
                    percent: percent(summary.productCost),
                    amount: summary.productCost,
                    currency: summary.currency,
                    subtitle: "Prenda + impresion/DTF"
                )
                AllocationValueRow(
                    title: "Merma",
                    icon: "percent",
                    color: AppTheme.red,
                    percent: percent(summary.wasteCost),
                    amount: summary.wasteCost,
                    currency: summary.currency,
                    subtitle: "2% sobre materia prima"
                )
                AllocationValueRow(
                    title: "Comisiones",
                    icon: "creditcard.fill",
                    color: AppTheme.purple,
                    percent: percent(summary.shopifyFee),
                    amount: summary.shopifyFee,
                    currency: summary.currency,
                    subtitle: "Shopify Payments estimado"
                )
                AllocationValueRow(
                    title: "Reserva fiscal",
                    icon: "building.columns.fill",
                    color: AppTheme.red,
                    percent: percent(summary.taxReserve),
                    amount: summary.taxReserve,
                    currency: summary.currency,
                    subtitle: "\(Int((summary.taxReserveRate * 100).rounded()))% para mantener caja sana"
                )
                AllocationValueRow(
                    title: "Caja libre",
                    icon: "eurosign.circle.fill",
                    color: summary.cashFree >= 0 ? AppTheme.green : AppTheme.red,
                    percent: percent(summary.cashFree),
                    amount: summary.cashFree,
                    currency: summary.currency
                )
            }

            Divider().background(AppTheme.line)

            HStack {
                Label("Costes totales", systemImage: "sum")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(AppTheme.muted)
                Spacer()
                Text("\(Int(percent(totalCost).rounded()))% · \(formatMoney(totalCost, currency: summary.currency))")
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
            }
        }
        .glassPanel(padding: 16, accent: summary.cashFree >= 0 ? AppTheme.green : AppTheme.red)
    }
}

struct AllocationValueRow: View {
    let title: String
    let icon: String
    let color: Color
    let percent: Double
    let amount: Double
    let currency: String
    var subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(color)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(AppTheme.ink)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(AppTheme.muted)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(formatMoney(amount, currency: currency))
                        .font(.subheadline.weight(.heavy))
                        .foregroundStyle(color)
                    Text("\(Int(percent.rounded()))%")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppTheme.muted)
                }
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(AppTheme.line.opacity(0.65))
                    Capsule()
                        .fill(color.opacity(0.85))
                        .frame(width: proxy.size.width * min(max(abs(percent), 0), 100) / 100)
                }
            }
            .frame(height: 8)
        }
        .padding(12)
        .background(AppTheme.surfaceSoft)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppTheme.line))
        .clipShape(RoundedRectangle(cornerRadius: 14))
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
            Text("Aparta esta cantidad de las ventas para pagar Sendcloud. Si Sendcloud aún no devuelve coste real, se estima con tu factura.")
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
            CostRow(label: "Merma estimada (2%)", value: summary.wasteCost, currency: summary.currency)
            CostRow(label: "Coste envíos", value: summary.shippingCost, currency: summary.currency)
            CostRow(label: "Comisión Shopify (2.4%)", value: summary.shopifyFee, currency: summary.currency)
            CostRow(label: "Reserva fiscal", value: summary.taxReserve, currency: summary.currency)
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
                Label("Coste envío estimado con factura Sendcloud", systemImage: "questionmark.circle")
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

func formatPayoutDate(_ value: String) -> String {
    let input = DateFormatter()
    input.locale = Locale(identifier: "es_ES")
    input.dateFormat = "yyyy-MM-dd"
    guard let date = input.date(from: value) else { return value }
    let output = DateFormatter()
    output.locale = Locale(identifier: "es_ES")
    output.dateFormat = "d MMM yyyy"
    return output.string(from: date)
}

func formatPayoutLineDate(_ date: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "es_ES")
    formatter.dateFormat = "d MMM"
    return formatter.string(from: date)
}

func payoutStatusText(_ status: String) -> String {
    switch status.lowercased() {
    case "scheduled": "Programado"
    case "in_transit": "En camino"
    case "paid": "Pagado"
    case "failed": "Fallido"
    case "canceled": "Cancelado"
    default: status.capitalized
    }
}

func bankCategoryText(_ category: String) -> String {
    switch category {
    case "SHOPIFY_PAYOUT": "Shopify"
    case "SENDCLOUD": "Envios"
    case "GARMENT_SUPPLIER": "Proveedor ropa"
    case "DTF_SUPPLIER": "DTF"
    case "TAX": "Impuestos"
    case "ADS": "Publicidad"
    case "SOFTWARE": "Software"
    case "OTHER_INCOME": "Otros ingresos"
    case "OTHER_EXPENSE": "Otros gastos"
    default: category.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

func payoutTypeText(_ type: String) -> String {
    switch type.lowercased() {
    case "charge": "Cargo"
    case "refund": "Reembolso"
    case "adjustment": "Ajuste"
    case "payout": "Pago"
    default: type.capitalized
    }
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
                if let preparedAt = shipment.preparedAt {
                    Label(preparedAt.formatted(.dateTime.day().month(.abbreviated).hour().minute()), systemImage: "clock.fill")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(AppTheme.amber)
                }
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

struct FinalizedItemRow: View {
    let item: FinalizedShipmentItem

    var body: some View {
        HStack(spacing: 10) {
            if let url = item.imageUrl.flatMap({ URL(string: $0) }) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default: Color.clear
                    }
                }
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(AppTheme.surfaceSoft)
                    .frame(width: 44, height: 44)
                    .overlay(Image(systemName: "tshirt.fill").foregroundStyle(AppTheme.mutedSoft).font(.caption))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.ink)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let color = item.color, !color.isEmpty {
                        Text(color).font(.caption).foregroundStyle(AppTheme.muted)
                    }
                    if let size = item.size, !size.isEmpty {
                        Text(size).font(.caption.weight(.bold)).foregroundStyle(AppTheme.teal)
                    }
                    if let variant = item.variantTitle, !variant.isEmpty, variant != item.color, variant != item.size {
                        Text(variant).font(.caption2).foregroundStyle(AppTheme.muted)
                    }
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("×\(item.quantity)")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(AppTheme.ink)
                if let price = item.unitPrice {
                    Text(String(format: "%.2f €", price * Double(item.quantity)))
                        .font(.caption2).foregroundStyle(AppTheme.muted)
                }
            }
        }
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

                if !shipment.items.isEmpty {
                    SectionHeader(title: "Contenido del pedido", subtitle: "\(shipment.items.reduce(0) { $0 + $1.quantity }) unidades enviadas")
                    VStack(spacing: 8) {
                        ForEach(shipment.items) { item in
                            FinalizedItemRow(item: item)
                        }
                    }
                    .glassPanel(padding: 12)
                }

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
