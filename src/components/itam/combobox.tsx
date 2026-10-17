'use client'

/**
 * combobox.tsx — reusable searchable combobox.
 *
 * Pattern: Popover + Command, supports BOTH selecting from a list AND typing
 * free-form text (the value is just a string — the parent owns it). Useful
 * for fields backed by MasterItem, AppSetting, or any list of suggestions
 * where the user should also be able to type a brand-new value.
 *
 * Usage:
 *   <Combobox
 *     items={[{ value: 'HP', label: 'Hewlett Packard' }]}
 *     value={form.brand}
 *     onChange={(v) => setForm({ ...form, brand: v })}
 *     placeholder="เลือกหรือพิมพ์..."
 *   />
 *
 * Optional props:
 *   - icon:       small lucide icon rendered left of the input (e.g. ScanLine)
 *   - groupLabel: render a sticky group header above the options
 *   - emptyText:  text shown when no options match (default "ไม่พบรายการ")
 *   - inputId:    id for the underlying input (used for barcode focus chaining)
 *   - inputRef:   ref forwarded to the underlying input
 *   - autoFocus:  focus the input on mount
 *   - onKeyDown:  extra keydown handler (Enter is NOT swallowed by default
 *                 when the popover is closed — the parent can use it to move
 *                 focus to the next field via document.getElementById)
 */

import * as React from 'react'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

export interface ComboboxItem {
  value: string
  label: string
}

export interface ComboboxProps {
  items: ComboboxItem[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  emptyText?: string
  groupLabel?: string
  icon?: React.ReactNode
  inputId?: string
  inputRef?: React.Ref<HTMLInputElement>
  autoFocus?: boolean
  disabled?: boolean
  className?: string
  /** When true (default), the popover opens on input focus. */
  openOnFocus?: boolean
  /** Pass-through for special key handling (e.g. Enter → next field). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  /**
   * Optional display override — when provided, the input shows
   * `displayValue(value)` instead of the raw value. Useful when the stored
   * value is an English code (e.g. "COMPANY") but the UI should show a
   * localized label (e.g. "ของบริษัท"). When the user starts typing, the
   * display falls back to the raw typed text until they pick an option.
   */
  displayValue?: (value: string) => string
  /**
   * Optional set of values to HIGHLIGHT in green. Used by the location
   * dropdowns to show which floors/departments actually have devices at
   * the selected building — so the user knows "this floor has 5 departments"
   * without blocking them from picking others.
   */
  highlightedValues?: string[]
  /**
   * Optional badge text to show next to highlighted items (e.g. "5 เครื่อง").
   * Keyed by the item value.
   */
  highlightBadges?: Record<string, string>
  /**
   * When provided, shows a "+ เพิ่มใหม่" item at the bottom of the dropdown.
   * Clicking it calls onAddNew(currentQuery). Useful for letting users add
   * a new entry without leaving the form.
   */
  onAddNew?: (query: string) => void
  /** Custom label for the add-new button (default: "เพิ่มใหม่"). */
  addNewLabel?: string
}

export function Combobox({
  items,
  value,
  onChange,
  placeholder = 'เลือกหรือพิมพ์...',
  emptyText = 'ไม่พบรายการ',
  groupLabel,
  icon,
  inputId,
  inputRef,
  autoFocus,
  disabled,
  className,
  openOnFocus = true,
  onKeyDown,
  displayValue,
  highlightedValues,
  highlightBadges,
  onAddNew,
  addNewLabel = 'เพิ่มใหม่',
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const internalRef = React.useRef<HTMLInputElement>(null)
  const ref = inputRef ?? internalRef

  // Normalize highlightedValues into a Set for O(1) lookup.
  const highlightSet = React.useMemo(
    () => new Set(highlightedValues ?? []),
    [highlightedValues],
  )

  // Items filtered by the user's typed query — case-insensitive substring
  // match on either the label or the value. Falls back to the full list when
  // the query is empty so the dropdown always shows something useful.
  // Highlighted items (green) are sorted to the TOP so the user doesn't
  // have to scroll to find them.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = !q
      ? items
      : items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            it.value.toLowerCase().includes(q),
        )
    // Sort: highlighted items first, then non-highlighted (preserve original order within each group)
    if (!highlightSet.size) return base
    return [...base].sort((a, b) => {
      const aHl = highlightSet.has(a.value) ? 0 : 1
      const bHl = highlightSet.has(b.value) ? 0 : 1
      return aHl - bHl
    })
  }, [items, query, highlightSet])

  // Alias for clarity in the render section (matches the new naming convention).
  const filteredFlat = filtered

  // Whether to show the "add new" button: only when onAddNew is provided
  // AND the query is non-empty AND the query doesn't exactly match an
  // existing item (avoid duplicates).
  const showAddNew =
    Boolean(onAddNew) &&
    query.trim().length > 0 &&
    !filteredFlat.some(
      (it) =>
        it.label.toLowerCase() === query.trim().toLowerCase() ||
        it.value.toLowerCase() === query.trim().toLowerCase(),
    )

  // Shared CommandItem renderer — supports green highlight + badge.
  function renderItem(it: ComboboxItem) {
    const isHighlighted = highlightSet.has(it.value)
    const badge = highlightBadges?.[it.value]
    return (
      <CommandItem
        key={it.value}
        value={it.value}
        onSelect={() => {
          onChange(it.value)
          setQuery('')
          setOpen(false)
        }}
        className={
          isHighlighted
            ? 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40'
            : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }
      >
        <Check
          className={`mr-2 h-3.5 w-3.5 ${
            value === it.value ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <span
          className={`flex-1 truncate text-sm ${
            isHighlighted
              ? 'font-semibold text-emerald-700 dark:text-emerald-400'
              : ''
          }`}
        >
          {it.label}
        </span>
        {isHighlighted && badge && (
          <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
            {badge}
          </span>
        )}
        {it.value !== it.label && (
          <span className="ml-2 font-mono text-[10px] text-slate-400">
            {it.value}
          </span>
        )}
      </CommandItem>
    )
  }

  // The visible text in the input:
  //  - If the user is typing (popover open + non-empty query), show the
  //    raw typed query so they can see what they're searching for.
  //  - If a displayValue override is provided, show displayValue(value).
  //  - Otherwise show the raw value (legacy behavior).
  const visibleValue =
    open && query ? query : displayValue ? displayValue(value) : value

  // Keep the input query in sync with the controlled value so typing in the
  // input both filters the dropdown AND updates the parent's form state.
  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    onChange(v)
  }

  function handleFocus() {
    // Use a microtask delay to avoid the "first click closes the dropdown"
    // issue that happens when the input receives focus and the popover
    // opens, but the subsequent click (on the trigger button or input)
    // is interpreted as a "blur" by the input. The 0ms setTimeout
    // defers the open so it doesn't race with the focus event.
    if (openOnFocus && items.length > 0) {
      setTimeout(() => setOpen(true), 0)
    }
  }

  function handleBlur() {
    // Delay close so click on a CommandItem has time to fire first.
    // 200ms is enough for most browsers' click event to register
    // after the input blur. Without this, the first selection would
    // close the dropdown before the click registers.
    setTimeout(() => {
      setOpen(false)
      setQuery('')
    }, 200)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setQuery('')
      // Blur the input to ensure focus leaves the combobox
      ;(e.target as HTMLInputElement).blur()
      return
    }
    // Only forward Enter when the popover is closed (so the parent can move
    // focus to the next field for barcode workflows). When the popover is
    // open, Command handles arrow/Enter internally.
    if (e.key === 'Enter' && !open) {
      onKeyDown?.(e)
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            {icon && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-slate-400">
                {icon}
              </span>
            )}
            <Input
              id={inputId}
              ref={ref}
              type="text"
              role="combobox"
              aria-expanded={open}
              value={visibleValue}
              onChange={handleInputChange}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              className={`${icon ? 'pl-8' : ''} pr-8 dark:bg-slate-800 dark:border-slate-700`}
              autoComplete="off"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setOpen((o) => !o)}
              aria-label="เปิดรายการ"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0 dark:border-slate-700 dark:bg-slate-900"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <div className="flex items-center border-b px-3 dark:border-slate-700">
              <Search className="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="ค้นหา..."
                className="h-8"
              />
            </div>
            <CommandList className="itam-scroll max-h-60">
              {filteredFlat.length === 0 && !showAddNew && (
                <CommandEmpty>{emptyText}</CommandEmpty>
              )}
              {groupLabel ? (
                <CommandGroup heading={groupLabel}>
                  {filteredFlat.map(renderItem)}
                </CommandGroup>
              ) : (
                <CommandGroup>
                  {filteredFlat.map(renderItem)}
                </CommandGroup>
              )}
              {/* Add-new button at the bottom */}
              {showAddNew && onAddNew && (
                <CommandGroup heading=" ">
                  <CommandItem
                    value={`__add_new__${query}`}
                    onSelect={() => {
                      onAddNew(query.trim())
                      setQuery('')
                      setOpen(false)
                    }}
                    className="border-t border-slate-100 text-[#f97316] hover:bg-[#f97316]/5 dark:border-slate-800 dark:text-[#fb923c]"
                  >
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    <span className="flex-1 text-sm font-medium">
                      {addNewLabel} <span className="font-mono">&ldquo;{query.trim()}&rdquo;</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
