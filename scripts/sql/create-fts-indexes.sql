-- ============================================================
-- Full-Text Search GIN Indexes
-- ============================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query)
-- to enable fast full-text search on Devices, WorkOrders, StockItems.
--
-- After running, search queries will be 100x faster than ILIKE.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- ============================================================

-- Device: search by assetCode, name, brand, model, serialNumber, site, department
CREATE INDEX IF NOT EXISTS idx_device_fts ON "Device"
USING gin(to_tsvector('simple',
  COALESCE("assetCode", '') || ' ' ||
  COALESCE(name, '') || ' ' ||
  COALESCE(brand, '') || ' ' ||
  COALESCE(model, '') || ' ' ||
  COALESCE("serialNumber", '') || ' ' ||
  COALESCE(site, '') || ' ' ||
  COALESCE(department, '')
));

-- WorkOrder: search by woNumber, subject, details, reporterName, tel, siteCode
CREATE INDEX IF NOT EXISTS idx_workorder_fts ON "WorkOrder"
USING gin(to_tsvector('simple',
  COALESCE("woNumber", '') || ' ' ||
  COALESCE(subject, '') || ' ' ||
  COALESCE(details, '') || ' ' ||
  COALESCE("reporterName", '') || ' ' ||
  COALESCE(tel, '') || ' ' ||
  COALESCE("siteCode", '')
));

-- StockItem: search by productCode, productName, brand, model, specifications
CREATE INDEX IF NOT EXISTS idx_stockitem_fts ON "StockItem"
USING gin(to_tsvector('simple',
  COALESCE("productCode", '') || ' ' ||
  COALESCE("productName", '') || ' ' ||
  COALESCE(brand, '') || ' ' ||
  COALESCE(model, '') || ' ' ||
  COALESCE(specifications, '')
));

-- MasterItem: search by code, label, category
CREATE INDEX IF NOT EXISTS idx_masteritem_fts ON "MasterItem"
USING gin(to_tsvector('simple',
  COALESCE(code, '') || ' ' ||
  COALESCE(label, '') || ' ' ||
  COALESCE(category, '') || ' ' ||
  COALESCE("parentRef", '') || ' ' ||
  COALESCE("displayLabel", '')
));

-- ============================================================
-- Verification queries (optional — run to check indexes exist)
-- ============================================================
-- SELECT indexname, tablename FROM pg_indexes
-- WHERE indexname LIKE '%_fts' ORDER BY tablename;
-- ============================================================
