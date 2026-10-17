/**
 * API Foundation — standard response shape, error handling, query parsing.
 *
 * All /api/v1/* routes MUST use these helpers so that every endpoint returns
 * the same envelope and supports the same query params.
 *
 * ════════════════════════════════════════════════════════════════════════
 * RESPONSE SHAPE (success)
 * ════════════════════════════════════════════════════════════════════════
 *   Single resource:
 *     { data: {...}, meta: { requestId, timestamp } }
 *
 *   List with pagination:
 *     { data: [...], pagination: { page, limit, total, totalPages, hasNext, hasPrev }, meta: {...} }
 *
 * ════════════════════════════════════════════════════════════════════════
 * RESPONSE SHAPE (error)
 * ════════════════════════════════════════════════════════════════════════
 *   { error: { code, message, details?, field? }, meta: { requestId, timestamp } }
 *
 * ════════════════════════════════════════════════════════════════════════
 * STANDARD QUERY PARAMS (all list endpoints)
 * ════════════════════════════════════════════════════════════════════════
 *   ?q=search          — full-text search
 *   ?page=1            — 1-based page number
 *   ?limit=20          — items per page (max 100)
 *   ?sort=field        — sort field (prefix - for descending, e.g. -createdAt)
 *   ?filter[status]=x  — exact match filter
 *   ?filter[status]=in:a,b,c — IN filter
 *   ?include=device    — comma-separated relations to expand
 *   ?fields=id,name    — sparse fieldset (only return these fields)
 */

import { NextResponse } from 'next/server'

// ── Types ─────────────────────────────────────────────────────────────────

export interface ApiMeta {
  requestId: string
  timestamp: string
  apiVersion: 'v1'
}

export interface ApiPagination {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  field?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────

function genRequestId(): string {
  return 'req-' + Math.random().toString(36).slice(2, 8)
}

function buildMeta(): ApiMeta {
  return {
    requestId: genRequestId(),
    timestamp: new Date().toISOString(),
    apiVersion: 'v1',
  }
}

// ── Success responses ────────────────────────────────────────────────────

export function ok<T>(data: T, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ data, meta: buildMeta(), ...extra })
}

export function created<T>(data: T, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ data, meta: buildMeta(), ...extra }, { status: 201 })
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 })
}

export function list<T>(
  data: T[],
  pagination: { page: number; limit: number; total: number },
  extra?: Record<string, unknown>,
): NextResponse {
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.limit))
  const p: ApiPagination = {
    page: pagination.page,
    limit: pagination.limit,
    total: pagination.total,
    totalPages,
    hasNext: pagination.page < totalPages,
    hasPrev: pagination.page > 1,
  }
  return NextResponse.json({ data, pagination: p, meta: buildMeta(), ...extra })
}

// ── Error responses ──────────────────────────────────────────────────────

export interface ErrorOptions {
  code?: string
  details?: Record<string, unknown>
  field?: string
}

export function badRequest(message: string, opts: ErrorOptions = {}): NextResponse {
  return NextResponse.json(
    { error: { code: opts.code ?? 'BAD_REQUEST', message, details: opts.details, field: opts.field }, meta: buildMeta() },
    { status: 400 },
  )
}

export function unauthorized(message = 'กรุณาเข้าสู่ระบบ'): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message }, meta: buildMeta() },
    { status: 401 },
  )
}

export function forbidden(message = 'ไม่มีสิทธิ์เพียงพอ'): NextResponse {
  return NextResponse.json(
    { error: { code: 'FORBIDDEN', message }, meta: buildMeta() },
    { status: 403 },
  )
}

export function notFound(resource = 'resource', message?: string): NextResponse {
  return NextResponse.json(
    { error: { code: 'NOT_FOUND', message: message ?? `ไม่พบ${resource}` }, meta: buildMeta() },
    { status: 404 },
  )
}

export function conflict(message: string, opts: ErrorOptions = {}): NextResponse {
  return NextResponse.json(
    { error: { code: opts.code ?? 'CONFLICT', message, details: opts.details, field: opts.field }, meta: buildMeta() },
    { status: 409 },
  )
}

export function unprocessable(message: string, opts: ErrorOptions = {}): NextResponse {
  return NextResponse.json(
    { error: { code: opts.code ?? 'UNPROCESSABLE', message, details: opts.details }, meta: buildMeta() },
    { status: 422 },
  )
}

export function serverError(message = 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์', opts: ErrorOptions = {}): NextResponse {
  return NextResponse.json(
    { error: { code: opts.code ?? 'INTERNAL_ERROR', message, details: opts.details }, meta: buildMeta() },
    { status: 500 },
  )
}

// ── Query param parsing ─────────────────────────────────────────────────

export interface ParsedQuery {
  search: string
  page: number
  limit: number
  sort: { field: string; desc: boolean } | null
  filters: Record<string, string>
  include: string[]
  fields: string[]
}

export function parseQuery(url: URL): ParsedQuery {
  const sp = url.searchParams
  const search = sp.get('q')?.trim() ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '20', 10) || 20))

  let sort: ParsedQuery['sort'] = null
  const sortRaw = sp.get('sort')?.trim()
  if (sortRaw) {
    const desc = sortRaw.startsWith('-')
    sort = { field: desc ? sortRaw.slice(1) : sortRaw, desc }
  }

  const filters: Record<string, string> = {}
  for (const [key, value] of sp.entries()) {
    const m = key.match(/^filter\[(.+)\]$/)
    if (m) filters[m[1]] = value
  }

  const includeRaw = sp.get('include')?.trim() ?? ''
  const include = includeRaw ? includeRaw.split(',').map((s) => s.trim()).filter(Boolean) : []

  const fieldsRaw = sp.get('fields')?.trim() ?? ''
  const fields = fieldsRaw ? fieldsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []

  return { search, page, limit, sort, filters, include, fields }
}

/**
 * Convert ParsedQuery → Prisma `where` using a field map.
 * Supports: exact match, in:a,b,c, null, notnull
 */
export function buildWhere(
  query: ParsedQuery,
  fieldMap: Record<string, string>,
  searchFields?: string[],
): Record<string, unknown> {
  const where: Record<string, unknown> = {}

  for (const [apiKey, rawValue] of Object.entries(query.filters)) {
    const prismaField = fieldMap[apiKey]
    if (!prismaField) continue
    if (rawValue.startsWith('in:')) {
      const values = rawValue.slice(3).split(',').map((s) => s.trim()).filter(Boolean)
      where[prismaField] = { in: values }
    } else if (rawValue === 'null') {
      where[prismaField] = null
    } else if (rawValue === 'notnull') {
      where[prismaField] = { not: null }
    } else {
      where[prismaField] = rawValue
    }
  }

  if (query.search && searchFields && searchFields.length > 0) {
    where.OR = searchFields.map((field) => ({
      [field]: { contains: query.search, mode: 'insensitive' },
    }))
  }

  return where
}

/**
 * Convert ParsedQuery.sort → Prisma `orderBy`.
 */
export function buildOrderBy(
  query: ParsedQuery,
  fieldMap: Record<string, string>,
  defaultSort: Record<string, 'asc' | 'desc'> = { createdAt: 'desc' },
): Record<string, 'asc' | 'desc'> {
  if (!query.sort) return defaultSort
  const prismaField = fieldMap[query.sort.field]
  if (!prismaField) return defaultSort
  return { [prismaField]: query.sort.desc ? 'desc' : 'asc' }
}
