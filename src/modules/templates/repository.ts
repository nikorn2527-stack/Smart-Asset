/**
 * Templates Repository — Prisma-backed persistence adapter.
 * NOT exported by the module barrel. Only the service layer uses this.
 */
import { db } from '@/lib/db'
import type {
  TemplateRecord,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateRepository,
} from './contracts'

export const templatesRepository: TemplateRepository = {
  async list(filter) {
    return db.documentTemplate.findMany({
      where: filter?.type ? { type: filter.type } : {},
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    }) as Promise<TemplateRecord[]>
  },

  async findById(id) {
    return db.documentTemplate.findUnique({ where: { id } }) as Promise<TemplateRecord | null>
  },

  async create(input: CreateTemplateInput) {
    return db.documentTemplate.create({
      data: {
        name: input.name,
        type: input.type,
        category: input.category,
        content: input.content,
        isActive: input.isActive,
        isDefault: input.isDefault,
      },
    }) as Promise<TemplateRecord>
  },

  async update(id, data: UpdateTemplateInput) {
    return db.documentTemplate.update({ where: { id }, data }) as Promise<TemplateRecord>
  },

  async delete(id) {
    try {
      return await db.documentTemplate.delete({ where: { id } }) as TemplateRecord
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') return null
      throw error
    }
  },

  async clearDefaultsForType(type, excludeId) {
    const result = await db.documentTemplate.updateMany({
      where: {
        type,
        isDefault: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isDefault: false },
    })
    return result.count
  },
}
