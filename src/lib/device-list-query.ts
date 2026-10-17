export const DEVICE_LIST_DEFAULT_LIMIT = 20
export const DEVICE_LIST_MAX_LIMIT = 100
export const DEVICE_LIST_MAX_PAGE = 100_000

export type DeviceListPagination = {
  page: number
  limit: number
  skip: number
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Parse untrusted list parameters into a bounded Prisma pagination window. */
export function parseDeviceListPagination(searchParams: URLSearchParams): DeviceListPagination {
  const requestedPage = positiveInt(searchParams.get('page'), 1)
  const page = Math.min(DEVICE_LIST_MAX_PAGE, requestedPage)
  const requestedLimit = positiveInt(searchParams.get('limit'), DEVICE_LIST_DEFAULT_LIMIT)
  const limit = Math.min(DEVICE_LIST_MAX_LIMIT, requestedLimit)
  return { page, limit, skip: (page - 1) * limit }
}
