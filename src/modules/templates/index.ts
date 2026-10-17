/**
 * Templates Module — public barrel export.
 *
 * Routes import from here — never from internal repository/service files.
 */
import { logAudit } from '@/lib/audit'
import { templatesRepository } from './repository'
import { createTemplatesService } from './service'

export { createTemplatesService } from './service'
export type {
  TemplateRecord,
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateRepository,
  TemplateAuditLogger,
} from './contracts'

export const templatesService = createTemplatesService(
  templatesRepository,
  async (action, template, detail) => {
    const actionLabel = action === 'CREATE' ? 'สร้าง' : action === 'UPDATE' ? 'แก้ไข' : 'ลบ'
    await logAudit(
      action,
      'DocumentTemplate',
      template.id,
      `${actionLabel}เทมเพลต "${template.name}" (${template.type})`,
      detail ?? { type: template.type, name: template.name },
    )
  },
)
