'use client'

/**
 * ProblemCategorySelector — เลือกประเภทปัญหาแบบ multi-select
 * จัดกลุ่มตาม RepairGroup (ไม่ใช่กองรวมที่เดียว) — collapsible sections
 *
 * Pure presentational component — caller is responsible for fetching
 * subject options (e.g. from /api/settings/options for staff, or
 * from a static fallback list for public forms).
 *
 * Features:
 *   - แต่ละ group เป็น section แยก มี header + collapse/expand
 *   - แต่ละ item เป็น checkbox (multi-select)
 *   - แสดง count ของที่เลือกในแต่ละ group
 *   - กลุ่มแรกขยายอัตโนมัติ
 *   - เมื่อเลือก "อื่นๆ (ระบุในรายละเอียด)" จะมีช่อง input ให้ระบุอาการเสียเพิ่ม
 *
 * Used by:
 *   - src/components/itam/mobile/mobile-repair-request.tsx (staff mobile form)
 *   - src/components/public/public-repair-form.tsx       (public QR form)
 */

import * as React from 'react'
import { Input } from '@/components/ui/input'

export interface ProblemCategory {
  id: string
  label: string
  group?: string
}

export interface SubjectOption {
  id?: string
  value: string
  default_priority?: string
  group?: string
}

export interface ProblemCategorySelectorProps {
  /** Categories to render — usually derived from SubjectOption[].value */
  categories: ProblemCategory[]
  /** Source subject options (used for looking up default_priority badges) */
  subjectOptions?: SubjectOption[]
  /** Currently-selected subject labels */
  selected: string[]
  /** Called with the next array of selected labels */
  onChange: (next: string[]) => void
  /** Free-text detail for "อื่นๆ (ระบุในรายละเอียด)" selection */
  otherDetail: string
  onOtherDetailChange: (value: string) => void
  /** Optional className wrapper */
  className?: string
}

const OTHER_LABEL = 'อื่นๆ (ระบุในรายละเอียด)'

export function ProblemCategorySelector({
  categories,
  subjectOptions = [],
  selected,
  onChange,
  otherDetail,
  onOtherDetailChange,
  className,
}: ProblemCategorySelectorProps) {
  // Group categories by group name
  const groups = React.useMemo(() => {
    const map = new Map<string, ProblemCategory[]>()
    for (const cat of categories) {
      const g = cat.group || 'อื่นๆ'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(cat)
    }
    return Array.from(map.entries())
  }, [categories])

  // First group expanded by default
  const [expandedGroups, setExpandedGroups] = React.useState<Set<string>>(
    () => new Set(groups.length > 0 ? [groups[0][0]] : []),
  )

  // Re-init expanded set if the set of group names changes (e.g. categories
  // load asynchronously after first render). Keep any currently-expanded
  // group that still exists.
  React.useEffect(() => {
    const validGroupNames = new Set(groups.map(([name]) => name))
    setExpandedGroups((prev) => {
      if (prev.size === 0 && validGroupNames.size > 0) {
        return new Set([groups[0][0]])
      }
      const next = new Set<string>()
      for (const g of prev) {
        if (validGroupNames.has(g)) next.add(g)
      }
      if (next.size === 0 && validGroupNames.size > 0) {
        next.add(groups[0][0])
      }
      return next
    })
  }, [groups])

  function toggleGroup(groupName: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  function toggleSubject(label: string) {
    if (selected.includes(label)) {
      onChange(selected.filter((s) => s !== label))
    } else {
      onChange([...selected, label])
    }
  }

  return (
    <div className={className ?? 'space-y-2'}>
      {groups.map(([groupName, cats]) => {
        const isExpanded = expandedGroups.has(groupName)
        const selectedInGroup = cats.filter((c) => selected.includes(c.label))
        const selectedCount = selectedInGroup.length

        return (
          <div
            key={groupName}
            className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
          >
            {/* Group header — clickable to expand/collapse */}
            <button
              type="button"
              onClick={() => toggleGroup(groupName)}
              className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-expanded={isExpanded}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {groupName}
                </span>
                {selectedCount > 0 && (
                  <span className="rounded-full bg-[#f97316] px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {selectedCount}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-400">
                {cats.length} หัวข้อ
                <span
                  className="ml-1 inline-block transition-transform"
                  style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}
                >
                  ›
                </span>
              </span>
            </button>

            {/* Items — checkbox list */}
            {isExpanded && (
              <div className="space-y-1 border-t border-slate-100 p-2 dark:border-slate-700">
                {cats.map((cat) => {
                  const isSelected = selected.includes(cat.label)
                  const opt = subjectOptions.find((o) => o.value === cat.label)
                  const priority = opt?.default_priority
                  const isOtherItem = cat.label === OTHER_LABEL

                  return (
                    <div key={cat.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                          isSelected
                            ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSubject(cat.label)}
                          className="h-4 w-4 rounded border-slate-300 text-[#f97316] focus:ring-[#f97316]"
                        />
                        <span className="flex-1">{cat.label}</span>
                        {priority && (
                          <span
                            className={`text-[10px] ${
                              priority === 'ด่วน'
                                ? 'text-rose-500'
                                : priority === 'สูง'
                                  ? 'text-orange-500'
                                  : priority === 'ปานกลาง'
                                    ? 'text-amber-500'
                                    : 'text-slate-400'
                            }`}
                          >
                            {priority}
                          </span>
                        )}
                      </label>
                      {/* When "อื่นๆ" is selected, show input for specifying the symptom */}
                      {isOtherItem && isSelected && (
                        <div className="mt-1 pl-6">
                          <Input
                            type="text"
                            value={otherDetail}
                            onChange={(e) => onOtherDetailChange(e.target.value)}
                            placeholder="ระบุอาการเสีย"
                            maxLength={200}
                            className="h-10 text-sm"
                            aria-label="ระบุอาการเสียอื่นๆ"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export { OTHER_LABEL as PROBLEM_CATEGORY_OTHER_LABEL }
