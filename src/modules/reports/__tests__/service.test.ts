import { describe, expect, it, vi } from 'vitest'
import { createReportsService } from '../service'
import type { ReportRecord, ReportRepository } from '../contracts'

const report: ReportRecord = {
  id: 'report-1', type: 'dashboard_summary', title: 'Summary', rangeKey: 'month',
  filters: '{"site":"UDH"}', data: '{"total":2}', format: 'json', createdAt: new Date(),
}

function repository(): ReportRepository {
  return {
    listRecent: vi.fn().mockResolvedValue([report]),
    findById: vi.fn().mockResolvedValue(report),
    create: vi.fn().mockResolvedValue(report),
    delete: vi.fn().mockResolvedValue(report),
  }
}

describe('reports service', () => {
  it('maps persisted JSON fields to a public report detail', async () => {
    const service = createReportsService(repository())
    await expect(service.getDetail('report-1')).resolves.toMatchObject({
      id: 'report-1', data: { total: 2 }, filters: { site: 'UDH' },
    })
  })

  it('returns null when a report does not exist', async () => {
    const repo = repository()
    vi.mocked(repo.findById).mockResolvedValue(null)
    await expect(createReportsService(repo).getDetail('missing')).resolves.toBeNull()
  })
})
