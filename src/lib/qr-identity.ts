import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/** Exact IDs are stable identities. Legacy suffixes/asset codes must resolve uniquely. */
export async function resolveDeviceQrIdentity(identifier: string, scope: Prisma.DeviceWhereInput = {}, includeSerial = false) {
  const value = identifier.trim()
  if (!value || value.length > 128 || /[\x00-\x1f]/.test(value)) return null
  const where = { AND: [scope, { deletedAt: null }] }
  const exact = await db.device.findFirst({ where: { AND: [where, { id: value }] } })
  if (exact) return exact
  const candidates = await db.device.findMany({
    where: { AND: [where, { OR: [{ id: { endsWith: value } }, { assetCode: value }, ...(includeSerial ? [{ serialNumber: value }] : [])] }] },
    take: 2,
  })
  return candidates.length === 1 ? candidates[0] : null
}

export async function resolveAccessoryQrIdentity(identifier: string, scope: Prisma.DeviceWhereInput) {
  const value = identifier.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null
  const where = { parentDevice: { AND: [scope, { deletedAt: null }] } }
  const exact = await db.deviceAccessory.findFirst({ where: { AND: [where, { id: value }] } })
  if (exact) return exact
  const candidates = await db.deviceAccessory.findMany({ where: { ...where, id: { endsWith: value } }, take: 2 })
  return candidates.length === 1 ? candidates[0] : null
}
