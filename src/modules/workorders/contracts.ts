export interface WorkOrderRecord {
  id: string
  woNumber: string | null
  status: string
  priority: string
  subject: string | null
  assignedTo: string | null
  createdAt: Date
  workCompletedAt: Date | null
}
export interface WorkOrderRepository {
  findById(id: string): Promise<WorkOrderRecord | null>
  listRecent(limit: number, filter?: { status?: string }): Promise<WorkOrderRecord[]>
}
