export interface DeviceRecord {
  id: string
  assetCode: string
  name: string
  brand: string
  model: string
  type: string
  status: string
  site: string
  serialNumber: string | null
  building: string | null
  floor: string | null
  department: string | null
}
export interface DeviceRepository {
  findById(id: string): Promise<DeviceRecord | null>
  findByAssetCode(assetCode: string): Promise<DeviceRecord | null>
  list(filter?: { site?: string; status?: string; limit?: number }): Promise<DeviceRecord[]>
}
