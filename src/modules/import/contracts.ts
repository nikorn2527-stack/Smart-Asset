/** Public DTOs for the import module. */
export interface ImportJobRecord {
  id: string
  jobType: string
  fileName: string
  fileType: string
  status: string
  totalRows: number
  processedRows: number
  errorRows: number
  errors: string | null
  uploadedBy: string | null
  createdAt: Date
  completedAt: Date | null
}

/**
 * Writable payload for `create()` — mirrors ImportJobUncheckedCreateInput.
 *
 * `jobType` and `fileName` are the only columns with no DB default, so they are
 * required here; everything else is defaulted by Prisma or nullable.
 * Server-managed columns (`id`, `createdAt`) are deliberately excluded — passing
 * them would make Prisma throw.
 *
 * Typing this explicitly (instead of `Partial<ImportJobRecord>`) means a missing
 * required column fails at COMPILE time rather than as a Prisma runtime error.
 */
export type ImportJobCreateInput = Required<
  Pick<ImportJobRecord, 'jobType' | 'fileName'>
> &
  Partial<
    Omit<ImportJobRecord, 'id' | 'createdAt' | 'jobType' | 'fileName'>
  >

export interface ImportJobRepository {
  listRecent(limit: number): Promise<ImportJobRecord[]>
  findById(id: string): Promise<ImportJobRecord | null>
  create(input: ImportJobCreateInput): Promise<ImportJobRecord>
  update(id: string, data: Partial<ImportJobCreateInput>): Promise<ImportJobRecord>
}
