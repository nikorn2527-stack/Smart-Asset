import { PrismaClient } from '@prisma/client'
import Database from 'better-sqlite3'

const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })
const p = new PrismaClient()

function fixDates(row: any, dateFields: string[]) {
  const out = { ...row }
  for (const f of dateFields) {
    if (out[f] !== null && typeof out[f] === 'number') out[f] = new Date(out[f])
  }
  return out
}

async function main() {
  // Delete partial WO
  await p.workOrder.deleteMany({})
  console.log('Deleted WOs')

  // WorkOrders — createMany in batches
  const wos = db.prepare('SELECT * FROM "WorkOrder"').all()
  console.log('WOs:', wos.length)
  const batch = 500
  for (let i = 0; i < wos.length; i += batch) {
    const data = wos.slice(i, i + batch).map(w => {
      const out = fixDates(w, ['createdAt','updatedAt','assignedAt','workCompletedAt','closedAt','canceledAt','editUnlockAt','editUnlockUpdatedAt','editUnlockClosedAt'])
      out.trackable = Boolean(out.trackable)
      out.editUnlockActive = Boolean(out.editUnlockActive)
      return out
    })
    try { await p.workOrder.createMany({ data, skipDuplicates: true }) } catch {}
    if ((i + batch) % 1000 === 0 || i + batch >= wos.length) console.log(`  ... ${Math.min(i + batch, wos.length)}/${wos.length}`)
  }

  // StockItems
  const items = db.prepare('SELECT * FROM "StockItem"').all()
  console.log('StockItems:', items.length)
  for (const s of items) {
    try {
      const si = fixDates(s, ['createdAt','updatedAt'])
      si.active = Boolean(si.active)
      si.quantity = Number(si.quantity) || 0
      si.minQuantity = Number(si.minQuantity) || 0
      si.maxQuantity = Number(si.maxQuantity) || 0
      if (si.unitCost !== null) si.unitCost = Number(si.unitCost)
      if (si.totalValue !== null) si.totalValue = Number(si.totalValue)
      await p.stockItem.upsert({ where: { productCode: si.productCode }, create: si, update: {} })
    } catch {}
  }

  // Users
  const users = db.prepare('SELECT * FROM "User"').all()
  console.log('Users:', users.length)
  for (const u of users) {
    try {
      const usr = fixDates(u, ['createdAt','updatedAt'])
      usr.active = Boolean(usr.active)
      await p.user.upsert({ where: { email: usr.email }, create: usr, update: {} })
    } catch {}
  }

  // AppSettings
  const settings = db.prepare('SELECT * FROM "AppSetting"').all()
  console.log('AppSettings:', settings.length)
  for (const s of settings) {
    try { const st = fixDates(s, ['updatedAt']); await p.appSetting.upsert({ where: { key: st.key }, create: st, update: {} }) } catch {}
  }

  // Templates
  const templates = db.prepare('SELECT * FROM "DocumentTemplate"').all()
  console.log('Templates:', templates.length)
  for (const t of templates) {
    try {
      const tpl = fixDates(t, ['createdAt','updatedAt'])
      tpl.isActive = Boolean(tpl.isActive)
      tpl.isDefault = Boolean(tpl.isDefault)
      if ('isFixed' in tpl) tpl.isFixed = Boolean(tpl.isFixed)
      await p.documentTemplate.upsert({ where: { id: tpl.id }, create: tpl, update: {} })
    } catch {}
  }

  // Cycles
  const cycles = db.prepare('SELECT * FROM "Cycle"').all()
  console.log('Cycles:', cycles.length)
  for (const c of cycles) {
    try { const cy = fixDates(c, ['createdAt','updatedAt']); await p.cycle.upsert({ where: { id: cy.id }, create: cy, update: {} }) } catch {}
  }

  console.log('\n✅ Done!')
  console.log('Devices:', await p.device.count())
  console.log('WorkOrders:', await p.workOrder.count())
  console.log('StockItems:', await p.stockItem.count())
  console.log('Users:', await p.user.count())

  db.close()
  await p.$disconnect()
}

main().catch(console.error)
