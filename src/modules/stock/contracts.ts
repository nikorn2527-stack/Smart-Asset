export interface StockItemRecord {
  id: string
  productCode: string
  productName: string
  category: string | null
  quantity: number
  minQuantity: number
  unit: string
  unitCost: number | null
  site: string | null
  active: boolean
}
export interface StockTransactionRecord {
  id: string
  type: string
  quantity: number
  productCode: string | null
  productName: string | null
  status: string
  createdAt: Date
}
export interface StockRepository {
  listItems(filter?: { site?: string }): Promise<StockItemRecord[]>
  findById(id: string): Promise<StockItemRecord | null>
}
