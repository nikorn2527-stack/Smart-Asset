'use client'

/**
 * PaginationBar — แถบ pagination มาตรฐานสำหรับทุกหน้า
 *
 * Features:
 *   - ปุ่ม ก่อนหน้า / ถัดไป
 *   - ช่องใส่เลขหน้า (พิมพ์ + Enter)
 *   - ปุ่มหน้าเลข (1, 2, 3, ..., 10)
 *   - เลือกจำนวนต่อหน้า (20/50/100)
 *   - แสดง "แสดง X-Y จาก Z รายการ"
 *
 * Usage:
 *   <PaginationBar
 *     page={page}
 *     pageSize={pageSize}
 *     total={total}
 *     totalPages={totalPages}
 *     onPageChange={setPage}
 *     onPageSizeChange={setPageSize}
 *   />
 */

import * as React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLang } from '@/store/i18n-store'

interface Props {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function PaginationBar({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}: Props) {
  const { lang } = useLang()
  const [pageInput, setPageInput] = React.useState(String(page))

  // Sync pageInput when page changes externally
  React.useEffect(() => {
    setPageInput(String(page))
  }, [page])

  const startIdx = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endIdx = Math.min(page * pageSize, total)

  // Generate page numbers to show (max 7 visible)
  const pageNumbers = React.useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }
    const pages: (number | '...')[] = [1]
    const start = Math.max(2, page - 1)
    const end = Math.min(totalPages - 1, page + 1)
    if (start > 2) pages.push('...')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < totalPages - 1) pages.push('...')
    pages.push(totalPages)
    return pages
  }, [page, totalPages])

  function handlePageJump(value: string) {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      onPageChange(n)
    } else {
      setPageInput(String(page))
    }
  }

  if (total === 0) return null

  return (
    <div className="mt-3 flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: info */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          แสดง <span className="font-semibold text-slate-700 dark:text-slate-200">{startIdx}-{endIdx}</span>
          {' '}จาก{' '}
          <span className="font-semibold text-slate-700 dark:text-slate-200">{(total ?? 0).toLocaleString(lang === 'th' ? 'th-TH' : 'en-GB')}</span>
          {' '}รายการ
        </span>
      </div>

      {/* Right: controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Per-page selector */}
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span>หน้าละ</span>
            <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
              <SelectTrigger className="h-8 w-[68px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* First page */}
        {totalPages > 5 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            className="h-8 w-8 p-0 dark:bg-slate-800 dark:border-slate-700"
            aria-label="หน้าแรก"
            title="หน้าแรก"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Previous */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="h-8 gap-1 px-2 text-xs dark:bg-slate-800 dark:border-slate-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">ก่อนหน้า</span>
        </Button>

        {/* Page numbers */}
        <div className="flex items-center gap-0.5">
          {pageNumbers.map((pn, i) =>
            pn === '...' ? (
              <span key={`dot-${i}`} className="px-1 text-xs text-slate-400">…</span>
            ) : (
              <button
                key={pn}
                type="button"
                onClick={() => onPageChange(pn as number)}
                className={`flex h-8 min-w-[32px] items-center justify-center rounded-md border px-1.5 text-xs font-medium transition-colors ${
                  pn === page
                    ? 'border-[#f97316] bg-[#f97316] text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {pn}
              </button>
            )
          )}
        </div>

        {/* Next */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="h-8 gap-1 px-2 text-xs dark:bg-slate-800 dark:border-slate-700"
        >
          <span className="hidden sm:inline">ถัดไป</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>

        {/* Last page */}
        {totalPages > 5 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            className="h-8 w-8 p-0 dark:bg-slate-800 dark:border-slate-700"
            aria-label="หน้าสุดท้าย"
            title="หน้าสุดท้าย"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}
