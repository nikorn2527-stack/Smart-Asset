import { db } from '@/lib/db'

export const STOCK_APPROVAL_SETTING_KEYS = [
  'stock.pendingApprovalMode',
  'stock.autoApproveDelayMinutes',
  'stock.autoApproveBatchLimit',
] as const

export type StockApprovalSettings = {
  approvalMode: 'manual' | 'auto'
  autoApproveDelayMinutes: number
  autoApproveBatchLimit: number
}

export function parseStockApprovalSettings(
  rows: Array<{ key: string; value: string }>,
): StockApprovalSettings {
  const values = new Map(rows.map((row) => [row.key, row.value]))
  const approvalMode = values.get('stock.pendingApprovalMode') === 'auto' ? 'auto' : 'manual'
  const delay = Number(values.get('stock.autoApproveDelayMinutes') ?? '60')
  const limit = Number(values.get('stock.autoApproveBatchLimit') ?? '100')
  return {
    approvalMode,
    autoApproveDelayMinutes: Number.isFinite(delay)
      ? Math.min(10080, Math.max(0, Math.round(delay)))
      : 60,
    autoApproveBatchLimit: Number.isFinite(limit)
      ? Math.min(500, Math.max(1, Math.round(limit)))
      : 100,
  }
}

export async function readStockApprovalSettings(): Promise<StockApprovalSettings> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: [...STOCK_APPROVAL_SETTING_KEYS] } },
  })
  return parseStockApprovalSettings(rows)
}
