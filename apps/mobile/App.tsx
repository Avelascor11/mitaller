import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { priorityColors, priorityLabels } from '@mitaller/shared';

type Task = {
  id: string;
  order: string;
  product: string;
  color?: string;
  size?: string;
  quantity: number;
  deadline: string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'BLOCKED';
  status: string;
};

const tasks: Task[] = [
  { id: '1', order: '#9464', product: 'Sudadera Fernando is faster than you', color: 'Negro', size: 'L', quantity: 1, deadline: 'Hoy 16:00', priority: 'CRITICAL', status: 'Pendiente' },
  { id: '2', order: '#9465', product: 'Camiseta MILF (MEN, I LOVE FERNANDO)', color: 'Negro', size: 'M', quantity: 1, deadline: 'Hoy 19:00', priority: 'HIGH', status: 'Pendiente' },
  { id: '3', order: '#9466', product: 'Camiseta NANO INMORTAL', color: 'Blanco', size: 'M', quantity: 1, deadline: 'Manana 11:00', priority: 'NORMAL', status: 'Pendiente' },
  { id: '4', order: '#9463', product: 'Camiseta NANO INMORTAL', color: 'Blanco', size: 'XL', quantity: 2, deadline: 'Bloqueado', priority: 'BLOCKED', status: 'Falta stock' }
];

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Login({ onLogin }: { onLogin: () => void }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.loginBox}>
        <Text style={styles.title}>Mitaller</Text>
        <Text style={styles.subtitle}>Operaciones de taller</Text>
        <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" defaultValue="admin@mitaller.local" />
        <TextInput style={styles.input} placeholder="Password" secureTextEntry defaultValue="demo1234" />
        <Pressable style={styles.primaryButton} onPress={onLogin}><Text style={styles.primaryButtonText}>Entrar</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

function Home() {
  const summary = useMemo(() => ({
    critical: tasks.filter((task) => task.priority === 'CRITICAL').length,
    high: tasks.filter((task) => task.priority === 'HIGH').length,
    blocked: tasks.filter((task) => task.priority === 'BLOCKED').length,
    ready: 1
  }), []);
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.question}>Que tengo que fabricar ahora?</Text>
      <TaskCard task={tasks[0]} />
      <View style={styles.grid}>
        <SummaryCard label="Criticas" value={summary.critical} color="#dc2626" />
        <SummaryCard label="Altas" value={summary.high} color="#f97316" />
        <SummaryCard label="Bloqueados" value={summary.blocked} color="#7f1d1d" />
        <SummaryCard label="Para preparar" value={summary.ready} color="#0f766e" />
      </View>
    </SafeAreaView>
  );
}

function ProductionNow() {
  return <TaskList title="Fabricar ahora" data={tasks.filter((task) => task.priority !== 'BLOCKED')} />;
}

function ProductionDetail() {
  const task = tasks[0];
  return (
    <SafeAreaView style={styles.screen}>
      <TaskCard task={task} />
      <Panel title="Componentes necesarios" rows={['Sudadera negra L - EST-A-01', 'Transfer Fernando - TALLER', 'Bolsa - TALLER']} />
      <Panel title="Pedido relacionado" rows={[task.order, 'Cliente Express', 'Express 24h']} />
      <View style={styles.actions}>
        <ActionButton label="Empezar" icon="play" />
        <ActionButton label="Fabricado" icon="checkmark" />
        <ActionButton label="Falta stock" icon="alert-circle" />
        <ActionButton label="Incidencia" icon="warning" />
      </View>
    </SafeAreaView>
  );
}

function Picking() {
  return <TaskList title="Preparacion / Picking" data={[{ ...tasks[2], product: 'Pedido completo #9466', status: 'Listo para preparar' }]} />;
}

function Shipping() {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.titleSmall}>Envios</Text>
      <TaskCard task={{ ...tasks[2], product: 'Pedido preparado #9466', status: 'Pendiente etiqueta' }} />
      <ActionButton label="Crear etiqueta" icon="pricetag" />
      <Text style={styles.muted}>El tracking real aparecera aqui cuando exista.</Text>
    </SafeAreaView>
  );
}

function Stock() {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.titleSmall}>Stock</Text>
      <TextInput style={styles.input} placeholder="Buscar SKU o escanear codigo" />
      <ActionButton label="Escanear QR / codigo de barras" icon="qr-code" />
      <Panel title="Resultado de escaneo" rows={['BLANK-TS-BLK-L', '2 uds en EST-A-01', 'Mover a FABRICADO']} />
    </SafeAreaView>
  );
}

function Incidents() {
  return <TaskList title="Incidencias" data={tasks.filter((task) => task.priority === 'BLOCKED')} />;
}

function TaskList({ title, data }: { title: string; data: Task[] }) {
  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.titleSmall}>{title}</Text>
      <FlatList data={data} keyExtractor={(item) => item.id} renderItem={({ item }) => <TaskCard task={item} />} contentContainerStyle={{ gap: 12 }} />
    </SafeAreaView>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.order}>{task.order}</Text>
        <Text style={[styles.badge, { backgroundColor: priorityColors[task.priority] }]}>{priorityLabels[task.priority]}</Text>
      </View>
      <Text style={styles.product}>{task.product}</Text>
      <Text style={styles.meta}>{[task.color, task.size, `${task.quantity} ud.`].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.deadline}>{task.deadline} · {task.status}</Text>
    </View>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={styles.summary}><Text style={[styles.summaryValue, { color }]}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function ActionButton({ label, icon }: { label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <Pressable style={styles.secondaryButton}><Ionicons name={icon} size={20} color="#111827" /><Text style={styles.secondaryButtonText}>{label}</Text></Pressable>;
}

function Panel({ title, rows }: { title: string; rows: string[] }) {
  return <View style={styles.card}><Text style={styles.panelTitle}>{title}</Text>{rows.map((row) => <Text key={row} style={styles.meta}>{row}</Text>)}</View>;
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarActiveTintColor: '#111827',
      tabBarIcon: ({ color, size }) => {
        const icons: Record<string, keyof typeof Ionicons.glyphMap> = { Home: 'home', Fabricar: 'hammer', Picking: 'cube', Envios: 'car', Stock: 'barcode', Incidencias: 'warning' };
        return <Ionicons name={icons[route.name]} color={color} size={size} />;
      }
    })}>
      <Tab.Screen name="Home" component={Home} />
      <Tab.Screen name="Fabricar" component={ProductionNow} />
      <Tab.Screen name="Picking" component={Picking} />
      <Tab.Screen name="Envios" component={Shipping} />
      <Tab.Screen name="Stock" component={Stock} />
      <Tab.Screen name="Incidencias" component={Incidents} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="ProductionDetail" component={ProductionDetail} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8fafc', padding: 18, gap: 14 },
  loginBox: { flex: 1, justifyContent: 'center', gap: 14 },
  title: { fontSize: 38, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 18, color: '#475569', marginBottom: 18 },
  question: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: '#111827' },
  titleSmall: { fontSize: 24, fontWeight: '800', color: '#111827' },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 14, fontSize: 16 },
  primaryButton: { backgroundColor: '#111827', borderRadius: 8, padding: 16, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryButton: { backgroundColor: '#e2e8f0', borderRadius: 8, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  secondaryButtonText: { color: '#111827', fontWeight: '800' },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  order: { fontSize: 18, fontWeight: '800', color: '#111827' },
  badge: { color: '#fff', overflow: 'hidden', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontWeight: '800', fontSize: 12 },
  product: { fontSize: 18, fontWeight: '700', color: '#111827' },
  meta: { color: '#475569', fontSize: 15 },
  deadline: { color: '#0f172a', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summary: { width: '48%', backgroundColor: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  summaryValue: { fontSize: 28, fontWeight: '900' },
  summaryLabel: { color: '#475569', fontWeight: '700' },
  actions: { gap: 10 },
  panelTitle: { fontWeight: '800', color: '#111827', fontSize: 16 },
  muted: { color: '#64748b' }
});
