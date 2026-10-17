/** Public DTOs and persistence port for the templates module. */
export interface TemplateRecord {
  id: string
  name: string
  type: string
  category: string | null
  content: string
  isActive: boolean
  isDefault: boolean
  isFixed: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateTemplateInput {
  name: string
  type: string
  category: string | null
  content: string
  isActive: boolean
  isDefault: boolean
}

export interface UpdateTemplateInput {
  name?: string
  type?: string
  category?: string | null
  content?: string
  isActive?: boolean
  isDefault?: boolean
}

export interface TemplateRepository {
  list(filter?: { type?: string }): Promise<TemplateRecord[]>
  findById(id: string): Promise<TemplateRecord | null>
  create(input: CreateTemplateInput): Promise<TemplateRecord>
  update(id: string, data: UpdateTemplateInput): Promise<TemplateRecord>
  delete(id: string): Promise<TemplateRecord | null>
  clearDefaultsForType(type: string, excludeId?: string): Promise<number>
}

export type TemplateAuditLogger = (
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  template: TemplateRecord,
  detail?: Record<string, unknown>,
) => Promise<unknown>
