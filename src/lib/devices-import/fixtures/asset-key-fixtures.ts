// ============================================================
// Devices Import — Fixtures for stable asset-key behavior
// ============================================================
// Module: Devices (Dev-3 / Asset & Meter Team)
// Work Package: C — parallel preparation
//
// Purpose: stable fixtures for asset-key behavior testing.
//   - canonical asset key formats
//   - legacy aliases that must map to the same canonical key
//   - case-insensitive matching
//   - whitespace/unicode handling
//
// These fixtures are PURE DATA — no DB, no I/O, no side effects.
// They are used by the test suite to verify that the parser and
// validator handle asset-key stability correctly across legacy
// and canonical formats.
//
// Governance:
//   - B4 frozen files untouched
//   - No SYNC_RUN permission added
//   - No schema/migration changes
//   - Pure functions, no DB
// ============================================================

/**
 * Canonical asset-key fixtures.
 * Each entry has:
 *   - canonical: the normalized form we expect to store
 *   - aliases: legacy/raw forms that must resolve to `canonical`
 *
 * Test strategy: for each fixture, parse the alias through the
 * parser, validate, and assert the resulting `assetCode` matches
 * `canonical`.
 */
export interface AssetKeyFixture {
  canonical: string
  aliases: string[]
  description: string
}

export const ASSET_KEY_FIXTURES: AssetKeyFixture[] = [
  {
    canonical: 'A001',
    aliases: ['A001', 'a001', 'A001 ', ' A001', 'A001\n'],
    description: 'simple uppercase asset code with whitespace variants',
  },
  {
    canonical: 'IT-ASSET-2026-001',
    aliases: ['IT-Asset-2026-001', 'it-asset-2026-001', 'IT-ASSET-2026-001'],
    description: 'hyphenated asset code with mixed case',
  },
  {
    canonical: 'ASSET_001',
    aliases: ['asset_001', 'ASSET_001', 'Asset_001'],
    description: 'underscore-separated asset code',
  },
  {
    canonical: 'A001',
    aliases: ['assetNo: A001', 'asset_code: A001', 'assetCode: A001'],
    description: 'prefixed legacy headers — parser should extract the value',
  },
]

/**
 * Duplicate-in-file fixture set.
 * Each entry is a CSV snippet containing intentional duplicates.
 * The validator should quarantine all but the first occurrence.
 */
export interface DuplicateFixture {
  name: string
  csvContent: string
  expectedReadyCount: number
  expectedQuarantineCount: number
  expectedDuplicateAssetCodes: string[]
  description: string
}

export const DUPLICATE_FIXTURES: DuplicateFixture[] = [
  {
    name: 'simple duplicate — same assetCode twice',
    csvContent: [
      'assetCode,name,brand,model,type',
      'A001,Printer,HP,LaserJet,PRINTER',
      'A001,Printer,HP,LaserJet,PRINTER',
    ].join('\n'),
    expectedReadyCount: 1,
    expectedQuarantineCount: 1,
    expectedDuplicateAssetCodes: ['A001'],
    description: 'two identical rows — second must be flagged as duplicate',
  },
  {
    name: 'case-insensitive duplicate — A001 vs a001',
    csvContent: [
      'assetCode,name,brand,model,type',
      'A001,Printer,HP,LaserJet,PRINTER',
      'a001,Scanner,Canon,Lide,SCANNER',
    ].join('\n'),
    expectedReadyCount: 1,
    expectedQuarantineCount: 1,
    expectedDuplicateAssetCodes: ['A001'],
    description: 'A001 and a001 should be treated as the same asset',
  },
  {
    name: 'triple duplicate — same assetCode three times',
    csvContent: [
      'assetCode,name,brand,model,type',
      'A001,Printer,HP,LaserJet,PRINTER',
      'A001,Scanner,Canon,Lide,SCANNER',
      'A001,Router,Cisco,ISR,NETWORK',
    ].join('\n'),
    expectedReadyCount: 1,
    expectedQuarantineCount: 2,
    expectedDuplicateAssetCodes: ['A001'],
    description: 'three rows with same assetCode — first kept, others flagged',
  },
  {
    name: 'mixed duplicates — multiple assetCodes',
    csvContent: [
      'assetCode,name,brand,model,type',
      'A001,Printer,HP,LaserJet,PRINTER',
      'A002,Scanner,Canon,Lide,SCANNER',
      'A001,Router,Cisco,ISR,NETWORK',
      'A003,Computer,Dell,Optiplex,COMPUTER',
      'A002,Printer,Epson,WF,PRINTER',
    ].join('\n'),
    expectedReadyCount: 3,
    expectedQuarantineCount: 2,
    expectedDuplicateAssetCodes: ['A001', 'A002'],
    description: 'A001 and A002 both duplicated once; A003 unique',
  },
]

/**
 * Missing-key fixture set.
 * Each entry is a CSV snippet with rows missing required assetCode.
 */
export interface MissingKeyFixture {
  name: string
  csvContent: string
  expectedErrorCount: number
  expectedErrorField: string
  description: string
}

export const MISSING_KEY_FIXTURES: MissingKeyFixture[] = [
  {
    name: 'empty assetCode cell',
    csvContent: [
      'assetCode,name,brand,model,type',
      ',Printer,HP,LaserJet,PRINTER',
    ].join('\n'),
    expectedErrorCount: 1,
    expectedErrorField: 'assetCode',
    description: 'assetCode is empty string — should fail required check',
  },
  {
    name: 'whitespace-only assetCode',
    csvContent: [
      'assetCode,name,brand,model,type',
      '   ,Printer,HP,LaserJet,PRINTER',
    ].join('\n'),
    expectedErrorCount: 1,
    expectedErrorField: 'assetCode',
    description: 'assetCode is whitespace-only — should fail after trim',
  },
  {
    name: 'missing assetCode column entirely',
    csvContent: [
      'name,brand,model,type',
      'Printer,HP,LaserJet,PRINTER',
    ].join('\n'),
    expectedErrorCount: 1,
    expectedErrorField: 'header',
    description: 'no assetCode column in header — should fail at parse stage',
  },
  {
    name: 'multiple rows missing assetCode',
    csvContent: [
      'assetCode,name,brand,model,type',
      ',Printer,HP,LaserJet,PRINTER',
      ',Scanner,Canon,Lide,SCANNER',
      'A001,Router,Cisco,ISR,NETWORK',
    ].join('\n'),
    expectedErrorCount: 2,
    expectedErrorField: 'assetCode',
    description: 'two rows missing assetCode, one valid — only valid kept',
  },
]
