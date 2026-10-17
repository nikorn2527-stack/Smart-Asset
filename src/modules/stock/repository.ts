import { db } from '@/lib/db'
import type { StockItemRecord, StockRepository } from './contracts'
export const stockRepository: StockRepository = {
  async listItems(filter) {
    return db.stockItem.findMany({
      where: filter?.site ? { site: filter.site } : {},
      orderBy: { productName: 'asc' },
    }) as Promise<StockItemRecord[]>
  },
  async findById(id) {
    return db.stockItem.findUnique({ where: { id } }) as Promise<StockItemRecord | null>
  },
}
