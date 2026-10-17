/**
 * Templates Service — business logic layer.
 * Owns default-clearing logic, audit logging, and validation.
 * Routes call this — never the repository directly.
 */
import type {
  TemplateRecord,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateRepository,
  TemplateAuditLogger,
} from './contracts'

export function createTemplatesService(
  repository: TemplateRepository,
  audit: TemplateAuditLogger = async () => undefined,
) {
  return {
    async list(type?: string): Promise<TemplateRecord[]> {
      return repository.list(type ? { type } : undefined)
    },

    async getDetail(id: string): Promise<TemplateRecord | null> {
      return repository.findById(id)
    },

    async create(input: CreateTemplateInput): Promise<TemplateRecord> {
      // If setting as default, clear other defaults for this type first
      if (input.isDefault) {
        await repository.clearDefaultsForType(input.type)
      }
      const template = await repository.create(input)
      await audit('CREATE', template, {
        type: template.type,
        name: template.name,
        isDefault: template.isDefault,
      })
      return template
    },

    async update(id: string, input: UpdateTemplateInput): Promise<TemplateRecord> {
      const before = await repository.findById(id)
      if (!before) throw new Error('ไม่พบเทมเพลต')

      // If setting as default, clear other defaults for this type
      if (input.isDefault === true) {
        const effectiveType = input.type ?? before.type
        await repository.clearDefaultsForType(effectiveType, id)
      }

      const updated = await repository.update(id, input)

      // Audit log of changed fields
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const k of ['name', 'type', 'category', 'isActive', 'isDefault'] as const) {
        if (input[k] !== undefined) {
          const from = before[k] as unknown
          const to = updated[k] as unknown
          if (String(from ?? '') !== String(to ?? '')) {
            changes[k] = { from, to }
          }
        }
      }
      if (input.content !== undefined) {
        changes.content = { from: '(เนื้อหาเดิม)', to: '(เนื้อหาใหม่)' }
      }
      await audit('UPDATE', updated, { changes })

      return updated
    },

    async remove(id: string): Promise<{ template: TemplateRecord | null; blocked: boolean }> {
      const template = await repository.findById(id)
      if (!template) return { template: null, blocked: false }

      // Block deletion of default templates
      if (template.isDefault) {
        return { template, blocked: true }
      }

      const deleted = await repository.delete(id)
      if (deleted) {
        await audit('DELETE', template, {
          type: template.type,
          name: template.name,
        })
      }
      return { template: deleted, blocked: false }
    },
  }
}
