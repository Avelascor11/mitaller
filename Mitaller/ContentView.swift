//
//  ContentView.swift
//  Mitaller
//
//  Created by Angel Velasco on 5/5/26.
//

import SwiftUI

enum PriorityLevel: String, CaseIterable, Identifiable {
    case critical = "CRITICO"
    case high = "ALTA"
    case normal = "NORMAL"
    case low = "BAJA"
    case blocked = "BLOQUEADO"

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .critical: .red
        case .high: .orange
        case .normal: .blue
        case .low: .gray
        case .blocked: .brown
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

    var hasMultipleItems: Bool { items.count > 1 }

    var shippingCategory: ShippingCategory {
        let value = shippingMethod.folding(options: .diacriticInsensitive, locale: .current).lowercased()
        if value.contains("premium") || value.contains("express") || value.contains("urgente") {
            return .premium
        }
        return .standard
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
        tracking: String? = nil
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
    }
}

enum ShippingCategory: String {
    case standard = "Estandar"
    case premium = "Premium"
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

enum PreparationPriorityFilter: String, CaseIterable, Identifiable {
    case all = "Todos"
    case urgent = "Críticos"
    case high = "Altos"
    case blocked = "Bloqueados"

    var id: String { rawValue }

    func matches(_ order: WorkshopOrder) -> Bool {
        switch self {
        case .all: true
        case .urgent: order.priority == .critical
        case .high: order.priority == .high
        case .blocked: order.priority == .blocked || order.status == .waitingStock
        }
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
    let pendingOrderNeed: Int
    let currentInternalStock: Int
    let minStockTarget: Int
    let recommendedPurchaseQuantity: Int
    let supplierAvailableQuantity: Int?
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
    var apiBaseURL = "http://192.168.1.247:3001"
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
                orders[index].tracking = shipment.trackingNumber
                orders[index].status = .labelCreated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo crear etiqueta en API: \(error.localizedDescription)"
        }
    }

    func scanLabelRemote(for order: WorkshopOrder, barcode: String) async {
        guard let client = apiClient else { return }
        labelScanOrderID = order.id
        syncError = nil
        defer { labelScanOrderID = nil }

        do {
            let shipment = try await client.scanLabel(orderId: order.remoteID ?? order.number, barcode: barcode)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index].tracking = shipment.trackingNumber ?? barcode
                orders[index].status = .labelCreated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo confirmar la etiqueta escaneada: \(error.localizedDescription)"
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

    func markPreparedRemote(_ order: WorkshopOrder) async {
        markPrepared(order)
        guard let client = apiClient else { return }
        do {
            let updated = try await client.markOrderPrepared(id: order.remoteID ?? order.number)
            if let index = orders.firstIndex(where: { $0.id == order.id }) {
                orders[index] = updated
            }
            await syncFromAPI()
        } catch {
            syncError = "No se pudo marcar preparado en API: \(error.localizedDescription)"
            await syncFromAPI()
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

    var body: some View {
        MainTabView()
            .environment(store)
            .task {
                await store.bootstrap()
            }
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(10))
                    await store.syncQuietlyIfIdle()
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
            AdminView()
                .tabItem { Label("Admin", systemImage: "chart.bar.xaxis") }
        }
    }
}

struct DashboardView: View {
    @Environment(WorkshopStore.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    SyncStatusView()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Ahora")
                            .font(.system(size: 38, weight: .black))
                        Text("La siguiente accion del taller, ordenada por urgencia.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let nextOrder = store.pendingPreparationOrders.first {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Siguiente pedido")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.secondary)
                                .textCase(.uppercase)
                            NavigationLink(value: nextOrder) {
                                PendingOrderRow(order: nextOrder, showsAction: false) {}
                                    .glassPanel(padding: 14)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        MetricTile(title: "Urgentes", value: store.urgentPendingOrders, color: .red, icon: "flame.fill")
                        MetricTile(title: "Altas", value: store.highPendingOrders, color: .orange, icon: "arrow.up.circle.fill")
                        MetricTile(title: "Bloqueados", value: store.blockedOrders, color: .brown, icon: "exclamationmark.triangle.fill")
                        MetricTile(title: "Sin preparar", value: store.pendingPreparationOrders.count, color: .purple, icon: "shippingbox.fill")
                    }
                    SectionHeader(title: "Cola urgente", subtitle: "Pedidos sin preparar ordenados por prioridad")
                    ForEach(store.pendingPreparationOrders.prefix(4)) { order in
                        NavigationLink(value: order) {
                            PendingOrderRow(order: order, showsAction: false) {}
                                .glassPanel(padding: 14)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Taller")
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
    @State private var shippingFilter: ShippingFilter = .all
    @State private var priorityFilter: PreparationPriorityFilter = .all

    var filteredOrders: [WorkshopOrder] {
        store.pendingPreparationOrders
            .filter { shippingFilter.matches($0) }
            .filter { priorityFilter.matches($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SyncStatusView()
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sin preparar")
                            .font(.system(size: 38, weight: .black))
                        Text("Pedidos reales desde #9454, ordenados por urgencia.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        MetricTile(title: "Críticos", value: store.urgentPendingOrders, color: .red, icon: "flame.fill")
                        MetricTile(title: "Altos", value: store.highPendingOrders, color: .orange, icon: "arrow.up.circle.fill")
                        MetricTile(title: "Bloqueados", value: store.blockedOrders, color: .brown, icon: "exclamationmark.triangle.fill")
                        MetricTile(title: "Total", value: filteredOrders.count, color: .purple, icon: "shippingbox.fill")
                    }

                    VStack(spacing: 10) {
                        Picker("Criticidad", selection: $priorityFilter) {
                            ForEach(PreparationPriorityFilter.allCases) { option in
                                Text(option.rawValue).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)

                        Picker("Envio", selection: $shippingFilter) {
                            ForEach(ShippingFilter.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    .glassPanel(padding: 12)

                    if filteredOrders.isEmpty {
                        ContentUnavailableView("Nada pendiente", systemImage: "checkmark.circle.fill", description: Text("No hay pedidos con estos filtros."))
                            .glassPanel()
                    } else {
                        ForEach(filteredOrders) { order in
                            NavigationLink(value: order) {
                                PendingOrderRow(order: order, showsAction: false) {}
                                    .glassPanel(padding: 14)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            }
            .screenBackground()
            .navigationTitle("Sin preparar")
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
        }
    }
}

struct ShippingView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var scanningOrder: WorkshopOrder?

    var shippingOrders: [WorkshopOrder] {
        store.orders
            .filter { $0.status == .readyForLabel || $0.status == .labelCreated }
            .sorted { $0.deadline < $1.deadline }
    }

    var body: some View {
        NavigationStack {
            List {
                SyncStatusView()
                ForEach(shippingOrders) { order in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(order.number).font(.title3.weight(.black))
                                Text(order.customer)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            PriorityBadge(priority: order.priority)
                        }
                        HStack(spacing: 8) {
                            StatusChip(status: order.status)
                            ShippingChip(category: order.shippingCategory)
                            Tag(text: order.hasMultipleItems ? "\(order.items.count) artículos" : "1 artículo", systemImage: "square.stack.3d.up.fill")
                        }
                        Text(order.shippingMethod).foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(order.items.prefix(4)) { item in
                                CompactOrderItemLine(item: item)
                            }
                            if order.items.count > 4 {
                                Text("+\(order.items.count - 4) artículos más")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.orange)
                            }
                        }

                        VStack(spacing: 8) {
                            if let tracking = order.tracking {
                                Label(tracking, systemImage: "barcode.viewfinder")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.teal)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            if order.tracking == nil {
                                Button { Task { await store.createLabelRemote(for: order) } } label: {
                                    if store.labelCreationOrderID == order.id {
                                        ProgressView()
                                            .frame(maxWidth: .infinity)
                                    } else {
                                        Label("Crear etiqueta", systemImage: "tag.fill")
                                            .frame(maxWidth: .infinity)
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(store.labelCreationOrderID != nil)
                            }

                            Button { scanningOrder = order } label: {
                                if store.labelScanOrderID == order.id {
                                    ProgressView()
                                        .frame(maxWidth: .infinity)
                                } else {
                                    Label(order.tracking == nil ? "Escanear código de etiqueta" : "Releer código de etiqueta", systemImage: "barcode.viewfinder")
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.teal)
                            .disabled(store.labelScanOrderID != nil)

                            Button { Task { await store.reopenPreparationRemote(order) } } label: {
                                Label("Volver a sin preparar", systemImage: "arrow.uturn.backward.circle.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                            .disabled(order.status != .readyForLabel)
                        }

                        NavigationLink(value: order) {
                            Label("Ver pedido completo", systemImage: "doc.text.magnifyingglass")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 6)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .screenBackground()
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
                    LabelScanView(order: order) { barcode in
                        scanningOrder = nil
                        Task { await store.scanLabelRemote(for: order, barcode: barcode) }
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

struct LabelScanView: View {
    let order: WorkshopOrder
    var onBarcode: (String) -> Void
    @State private var manualBarcode = ""

    var body: some View {
        VStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Lee el código de barras de la etiqueta")
                    .font(.headline.weight(.black))
                Text("Al leerlo, se guarda como tracking y se marca el pedido como preparado en Shopify si es un pedido real.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()

            BarcodeScannerView { code in
                onBarcode(code)
            }
            .frame(maxWidth: .infinity, minHeight: 340)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal)

            VStack(spacing: 10) {
                TextField("Número de barras / tracking", text: $manualBarcode)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.characters)
                Button {
                    onBarcode(manualBarcode)
                } label: {
                    Label("Confirmar número", systemImage: "checkmark.seal.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
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
                        Text("Stock real del taller. Toca una talla para modificar unidades.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalStock }, color: .green, icon: "archivebox.fill")
                        MetricTile(title: "Con stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock > 0 }.count }, color: .blue, icon: "checkmark.circle.fill")
                        MetricTile(title: "Sin stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.entries.filter { $0.currentInternalStock == 0 }.count }, color: .orange, icon: "exclamationmark.circle.fill")
                    }

                    VStack(spacing: 10) {
                        TextField("Buscar camiseta, sudadera, color o talla", text: $query)
                            .textFieldStyle(.roundedBorder)
                        Button { showingScanner = true } label: {
                            Label("Escanear QR / codigo de barras", systemImage: "barcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
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
                    BarcodeScannerView { code in
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
                            .foregroundStyle(entry.currentInternalStock > 0 ? .green : .primary)
                            .frame(maxWidth: .infinity, minHeight: 64)
                            .background(.background)
                    }
                    .buttonStyle(.plain)
                    .disabled(entry.sku == nil)
                    .overlay(alignment: .trailing) {
                        Divider()
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(0.7), lineWidth: 1))
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
                    Text("Pedidos sin preparar: \(selection.entry.pendingOrderNeed)")
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Unidades en stock")
                        .font(.headline.weight(.bold))
                    TextField("Stock", text: $quantityText)
                        .keyboardType(.numberPad)
                        .font(.system(size: 44, weight: .black))
                        .multilineTextAlignment(.center)
                        .padding(.vertical, 12)
                        .background(.background)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .glassPanel()

                Text("Al guardar, Compras recalcula automaticamente lo que hay que pedir.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

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
                        Text("Unidades a comprar segun pedidos sin preparar y stock actual.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                        MetricTile(title: "Comprar", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalRecommended }, color: .red, icon: "cart.badge.plus")
                        MetricTile(title: "Pedidos", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalPending }, color: .blue, icon: "shippingbox.fill")
                        MetricTile(title: "Stock", value: store.purchaseMatrix.reduce(0) { $0 + $1.totalStock }, color: .green, icon: "archivebox.fill")
                    }

                    ForEach(store.purchaseMatrix.filter { $0.totalRecommended > 0 }) { group in
                        PurchaseMatrixCard(group: group, mode: .recommended)
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
                    .background(group.foregroundColor.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
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
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.primary.opacity(0.75), lineWidth: 1))
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
                .foregroundStyle(value > 0 && mode == .recommended ? .red : .primary)
            if mode == .recommended && entry.pendingOrderNeed > 0 {
                Text("ped \(entry.pendingOrderNeed) · stk \(entry.currentInternalStock)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            if mode != .recommended {
                Text(entry.subproductName.replacingOccurrences(of: "Camiseta ", with: "").replacingOccurrences(of: "Sudadera ", with: ""))
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.75)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 54)
        .background(.background)
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
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Admin")
        }
    }
}

struct TaskCard: View {
    let task: WorkshopTask
    let showsActions: Bool

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 4)
                .fill(task.priority.color)
                .frame(width: 5)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(task.orderNumber)
                        .font(.title3.weight(.black))
                    Spacer()
                    PriorityBadge(priority: task.priority)
                }
                Text(task.productName)
                    .font(.headline)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if !task.color.isEmpty { Tag(text: task.color, systemImage: "paintpalette.fill") }
                    if !task.size.isEmpty { Tag(text: task.size, systemImage: "ruler.fill") }
                    Tag(text: "\(task.quantity) ud.", systemImage: "number")
                }
                HStack {
                    Label(task.deadline, systemImage: "clock.fill")
                    Spacer()
                    Text(task.status.rawValue)
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.secondary)
                if let reason = task.blockedReason {
                    Label(reason, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                }
            }
        }
        .glassPanel(padding: 14)
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
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(order.number)
                        .font(.title3.weight(.black))
                    Text(order.customer)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                PriorityBadge(priority: order.priority)
            }
            HStack(spacing: 8) {
                StatusChip(status: order.status)
                ShippingChip(category: order.shippingCategory)
                Tag(text: order.hasMultipleItems ? "\(order.items.count) prendas/artículos" : "1 artículo", systemImage: "square.stack.3d.up.fill")
            }
            Text(order.shippingMethod)
                .font(.footnote)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 7) {
                ForEach(order.items.prefix(3)) { item in
                    CompactOrderItemLine(item: item)
                }
                if order.items.count > 3 {
                    Text("+\(order.items.count - 3) artículos más dentro")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.orange)
                }
            }
            if showsAction {
                Button(action: markPrepared) {
                    Label("Pedido preparado", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(order.status == .waitingStock)
            }
        }
        .padding(.vertical, 4)
    }
}

struct OrderPreparationDetailView: View {
    @Environment(WorkshopStore.self) private var store
    @State private var showingQuantityWarning = false
    let order: WorkshopOrder

    var currentOrder: WorkshopOrder {
        store.orders.first(where: { $0.remoteID == order.remoteID || $0.number == order.number }) ?? order
    }

    var repeatedQuantityItems: [WorkshopOrderItem] {
        currentOrder.items.filter { $0.quantity > 1 }
    }

    var quantityWarningMessage: String {
        repeatedQuantityItems
            .map { "\($0.displayTitle): x\($0.quantity)" }
            .joined(separator: "\n")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(currentOrder.number)
                                .font(.system(size: 34, weight: .black))
                            Text(currentOrder.customer)
                                .font(.headline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        PriorityBadge(priority: currentOrder.priority)
                    }
                    HStack(spacing: 8) {
                        StatusChip(status: currentOrder.status)
                        ShippingChip(category: currentOrder.shippingCategory)
                        Tag(text: "\(currentOrder.items.count) artículos", systemImage: "square.stack.3d.up.fill")
                    }
                    Label(currentOrder.deadline, systemImage: "clock.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(currentOrder.priority.color)
                    Text(currentOrder.shippingMethod)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .glassPanel()

                SectionHeader(title: "Contenido del pedido", subtitle: "Revisa unidades y prendas antes de marcarlo preparado")

                if !repeatedQuantityItems.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Revisa unidades repetidas", systemImage: "exclamationmark.triangle.fill")
                            .font(.headline.weight(.black))
                            .foregroundStyle(.orange)
                        Text("Hay algun item con 2 o mas unidades. Comprueba que van todas dentro del paquete.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
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
                            .foregroundStyle(.secondary)
                    }
                    .glassPanel()
                } else {
                    Button {
                        if repeatedQuantityItems.isEmpty {
                            Task { await store.markPreparedRemote(currentOrder) }
                        } else {
                            showingQuantityWarning = true
                        }
                    } label: {
                        Label("Pedido preparado", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(currentOrder.status == .waitingStock)
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle(currentOrder.number)
        .navigationBarTitleDisplayMode(.inline)
        .alert("Revisa antes de preparar", isPresented: $showingQuantityWarning) {
            Button("Cancelar", role: .cancel) {}
            Button("Si, esta revisado") {
                Task { await store.markPreparedRemote(currentOrder) }
            }
        } message: {
            Text("Hay items con mas de 1 unidad:\n\n\(quantityWarningMessage)")
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
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                    Text(item.quantity == 1 ? "x1 unidad" : "x\(item.quantity) unidades")
                        .font(.title2.weight(.black))
                        .foregroundStyle(item.quantity > 1 ? .orange : .secondary)
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
                    .lineLimit(3)
                if !item.detailLine.isEmpty {
                    Text(item.detailLine)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .glassPanel(padding: 14)
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
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(.quaternary, lineWidth: 1))
    }

    private var placeholder: some View {
        ZStack {
            Color(.secondarySystemGroupedBackground)
            Text(initials.isEmpty ? "?" : initials)
                .font(.headline.weight(.black))
                .foregroundStyle(.secondary)
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
            HStack {
                Image(systemName: icon)
                    .font(.headline)
                    .foregroundStyle(color)
                    .frame(width: 34, height: 34)
                    .background(color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Spacer()
            }
            Text("\(value)")
                .font(.system(size: 34, weight: .black))
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(padding: 16)
    }
}

struct PriorityBadge: View {
    let priority: PriorityLevel

    var body: some View {
        Text(priority.rawValue)
            .font(.caption.weight(.black))
            .foregroundStyle(priority.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(priority.color.opacity(0.14))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct StatusChip: View {
    let status: OrderStatus

    var body: some View {
        Label(status.label, systemImage: status == .waitingStock ? "exclamationmark.triangle.fill" : "shippingbox.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(status == .waitingStock ? .orange : .secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(.quaternary)
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct ShippingChip: View {
    let category: ShippingCategory

    var body: some View {
        Label(category.rawValue, systemImage: category == .premium ? "bolt.fill" : "shippingbox.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(category == .premium ? .orange : .blue)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background((category == .premium ? Color.orange : Color.blue).opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct Tag: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(.quaternary.opacity(0.8))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

struct SectionHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.title3.weight(.black))
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

struct InfoPanel: View {
    let title: String
    let rows: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            ForEach(rows, id: \.self) { row in
                Label(row, systemImage: "circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
            HStack {
                Label(store.isAPIConnected ? "API conectada" : "API sin conexion", systemImage: store.isAPIConnected ? "checkmark.icloud.fill" : "exclamationmark.icloud.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(store.isAPIConnected ? .teal : .orange)
                Spacer()
                if store.isLoading {
                    ProgressView()
                } else {
                    Text(store.lastSyncText)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let syncError = store.syncError {
                Text(syncError)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .glassPanel(padding: 12)
    }
}

struct GlassPanelModifier: ViewModifier {
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.white.opacity(0.28), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.05), radius: 12, y: 6)
    }
}

struct ScreenBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color(.systemGroupedBackground))
    }
}

extension View {
    func glassPanel(padding: CGFloat = 16) -> some View {
        modifier(GlassPanelModifier(padding: padding))
    }

    func screenBackground() -> some View {
        modifier(ScreenBackgroundModifier())
    }
}

#Preview {
    ContentView()
}
