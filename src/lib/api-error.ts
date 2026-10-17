/**
 * api-error.ts — Standardized API error response helper.
 *
 * L-26 fix: all API routes should use apiErrorResponse() instead of
 * throwing raw error messages to the client.
 *
 * Response format:
 *   {
 *     ok: false,
 *     error: {
 *       code: "RESOURCE_NOT_FOUND",
 *       messageKey: "common.notFound",
 *       requestId: "req_abc123",
 *       detail?: "..." (dev only, never in production)
 *     }
 *   }
 *
 * Usage in a route handler:
 *   import { apiErrorResponse, ApiErrorCode } from '@/lib/api-error'
 *   return apiErrorResponse('RESOURCE_NOT_FOUND', 'common.notFound', 404, req)
 */

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'VERSION_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'SETUP_LOCKED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'RESOURCE_NOT_FOUND'
  | 'DUPLICATE_RESOURCE'
  | 'DEPENDENCY_ERROR'

interface ApiErrorBody {
  ok: false
  error: {
    code: ApiErrorCode
    messageKey: string
    requestId: string
    detail?: string
  }
}

const STATUS_MAP: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 422,
  SETUP_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DUPLICATE_RESOURCE: 409,
  DEPENDENCY_ERROR: 424,
}

/**
 * Create a standardized API error response.
 *
 * @param code — machine-readable error code (e.g. 'NOT_FOUND')
 * @param messageKey — i18n key for client-side translation (e.g. 'common.notFound')
 * @param status — HTTP status code (auto-derived from code if omitted)
 * @param req — optional NextRequest for request ID extraction
 * @param detail — optional detail message (only shown in dev mode)
 */
export function apiErrorResponse(
  code: ApiErrorCode,
  messageKey: string,
  status?: number,
  req?: Request,
  detail?: string,
): NextResponse<ApiErrorBody> {
  const httpStatus = status ?? STATUS_MAP[code] ?? 500
  const requestId = req?.headers.get('x-request-id') || randomUUID().slice(0, 12)
  const isDev = process.env.NODE_ENV !== 'production'

  const body: ApiErrorBody = {
    ok: false,
    error: {
      code,
      messageKey,
      requestId,
      ...(isDev && detail ? { detail } : {}),
    },
  }

  return NextResponse.json(body, { status: httpStatus })
}

/**
 * Create a success response with standard envelope.
 *
 * @param data — the response payload
 * @param status — HTTP status (default 200)
 */
export function apiSuccessResponse<T>(data: T, status = 200): NextResponse<{
  ok: true
  data: T
}> {
  return NextResponse.json({ ok: true, data }, { status })
}
