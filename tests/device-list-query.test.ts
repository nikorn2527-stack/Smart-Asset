import { describe, expect, it } from 'vitest'
import {
  DEVICE_LIST_DEFAULT_LIMIT,
  DEVICE_LIST_MAX_LIMIT,
  DEVICE_LIST_MAX_PAGE,
  parseDeviceListPagination,
} from '@/lib/device-list-query'

describe('parseDeviceListPagination', () => {
  it('uses safe defaults for an empty query', () => {
    expect(parseDeviceListPagination(new URLSearchParams())).toEqual({
      page: 1,
      limit: DEVICE_LIST_DEFAULT_LIMIT,
      skip: 0,
    })
  })

  it('caps oversized pages and computes the bounded offset', () => {
    expect(parseDeviceListPagination(new URLSearchParams('page=3&limit=99999'))).toEqual({
      page: 3,
      limit: DEVICE_LIST_MAX_LIMIT,
      skip: DEVICE_LIST_MAX_LIMIT * 2,
    })
  })

  it('caps an extreme page number before computing the offset', () => {
    expect(parseDeviceListPagination(new URLSearchParams('page=999999999&limit=200'))).toEqual({
      page: DEVICE_LIST_MAX_PAGE,
      limit: DEVICE_LIST_MAX_LIMIT,
      skip: (DEVICE_LIST_MAX_PAGE - 1) * DEVICE_LIST_MAX_LIMIT,
    })
  })

  it('fails closed to defaults for invalid and negative values', () => {
    expect(parseDeviceListPagination(new URLSearchParams('page=-1&limit=0'))).toEqual({
      page: 1,
      limit: DEVICE_LIST_DEFAULT_LIMIT,
      skip: 0,
    })
    expect(parseDeviceListPagination(new URLSearchParams('page=nope&limit=abc'))).toEqual({
      page: 1,
      limit: DEVICE_LIST_DEFAULT_LIMIT,
      skip: 0,
    })
  })
})
