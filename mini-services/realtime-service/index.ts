/**
 * realtime-service/index.ts — Socket.io server for live dashboard updates.
 *
 * Emits every 30 seconds:
 *   - kpi:update { devices, workOrders, pendingWO, lowStock, warrantyExpiring, recentActivities }
 *
 * Also emits on DB change (polled every 10s):
 *   - device:created, workorder:created, meter:recorded
 *
 * Connects to the same SQLite DB at /home/z/my-project/db/custom.db (read-only).
 * Port: 3003 (must use XTransformPort=3003 from client).
 */
import { createServer } from 'http'
import { Server } from 'socket.io'
import { Database } from 'bun:sqlite'

const PORT = 3003
const DB_PATH = '/home/z/my-project/db/custom.db'

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'realtime', uptime: process.uptime() }))
    return
  }
  res.writeHead(404)
  res.end('Not Found')
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/socket.io/',
})

// Open read-only SQLite connection
const db = new Database(DB_PATH, { readonly: true })

// Track previous counts to detect changes
let prevCounts = { devices: 0, workOrders: 0, meterReadings: 0 }

function getCount(table: string): number {
  try {
    const r = db.prepare(`SELECT count(*) as c FROM ${table}`).get() as { c: number } | undefined
    return r?.c ?? 0
  } catch {
    return 0
  }
}

function getKpi() {
  const devices = getCount('Device')
  const workOrders = getCount('WorkOrder')
  const pendingWO = (() => {
    try {
      const r = db.prepare("SELECT count(*) as c FROM WorkOrder WHERE status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS')").get() as { c: number } | undefined
      return r?.c ?? 0
    } catch { return 0 }
  })()
  const lowStock = (() => {
    try {
      const r = db.prepare('SELECT count(*) as c FROM StockItem WHERE quantity <= minQuantity').get() as { c: number } | undefined
      return r?.c ?? 0
    } catch { return 0 }
  })()
  const warrantyExpiring = (() => {
    try {
      const today = new Date()
      const future = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
      const todayStr = today.toISOString().slice(0, 10)
      const futureStr = future.toISOString().slice(0, 10)
      const r = db.prepare('SELECT count(*) as c FROM Device WHERE warrantyEnd IS NOT NULL AND warrantyEnd != "" AND warrantyEnd >= ? AND warrantyEnd <= ?').get(todayStr, futureStr) as { c: number } | undefined
      return r?.c ?? 0
    } catch { return 0 }
  })()
  const recentActivities = (() => {
    try {
      const rows = db.prepare('SELECT action, entity, summary, actor, createdAt FROM AuditLog ORDER BY createdAt DESC LIMIT 5').all() as any[]
      return rows.map(r => ({
        action: r.action,
        entity: r.entity,
        summary: String(r.summary || '').slice(0, 100),
        actor: r.actor,
        createdAt: r.createdAt,
      }))
    } catch { return [] }
  })()

  return { devices, workOrders, pendingWO, lowStock, warrantyExpiring, recentActivities }
}

// Connection handler
io.on('connection', (socket) => {
  console.log(`[realtime] client connected: ${socket.id}`)
  // Send initial KPI immediately on connect
  socket.emit('kpi:update', getKpi())

  socket.on('disconnect', () => {
    console.log(`[realtime] client disconnected: ${socket.id}`)
  })
})

// Emit KPI updates every 30 seconds
setInterval(() => {
  const kpi = getKpi()
  io.emit('kpi:update', kpi)
  console.log(`[realtime] kpi:update emitted (devices=${kpi.devices}, wo=${kpi.workOrders})`)
}, 30_000)

// Detect changes every 10 seconds (emit specific events)
setInterval(() => {
  const devices = getCount('Device')
  const workOrders = getCount('WorkOrder')
  const meterReadings = getCount('MeterReading')

  if (devices > prevCounts.devices) {
    io.emit('device:created', { count: devices, delta: devices - prevCounts.devices })
    console.log(`[realtime] device:created (delta=${devices - prevCounts.devices})`)
  }
  if (workOrders > prevCounts.workOrders) {
    io.emit('workorder:created', { count: workOrders, delta: workOrders - prevCounts.workOrders })
    console.log(`[realtime] workorder:created (delta=${workOrders - prevCounts.workOrders})`)
  }
  if (meterReadings > prevCounts.meterReadings) {
    io.emit('meter:recorded', { count: meterReadings, delta: meterReadings - prevCounts.meterReadings })
    console.log(`[realtime] meter:recorded (delta=${meterReadings - prevCounts.meterReadings})`)
  }

  prevCounts = { devices, workOrders, meterReadings }
}, 10_000)

// Initialize prev counts
prevCounts = {
  devices: getCount('Device'),
  workOrders: getCount('WorkOrder'),
  meterReadings: getCount('MeterReading'),
}

httpServer.listen(PORT, () => {
  console.log(`[realtime] socket.io server listening on port ${PORT}`)
  console.log(`[realtime] DB: ${DB_PATH}`)
  console.log(`[realtime] initial counts:`, prevCounts)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[realtime] shutting down...')
  io.close()
  httpServer.close()
  db.close()
  process.exit(0)
})
