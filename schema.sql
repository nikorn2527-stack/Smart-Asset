PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT '',
  source_scope TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  container_filename TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(filename, sha256)
);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  UNIQUE(name, code)
);

CREATE TABLE IF NOT EXISTS org_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'department',
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  UNIQUE(organization_id, parent_unit_id, name, unit_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_units_unique_scope
  ON org_units(organization_id, COALESCE(parent_unit_id, 0), name, unit_type);

CREATE TABLE IF NOT EXISTS depreciation_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  rule_no TEXT NOT NULL,
  category_name TEXT NOT NULL,
  useful_life_years REAL,
  annual_rate_percent REAL,
  scope TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source_page INTEGER,
  raw_text TEXT NOT NULL DEFAULT '',
  calculation_method TEXT NOT NULL DEFAULT 'annual_rate',
  residual_value_percent REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_document_id, rule_no)
);

CREATE TABLE IF NOT EXISTS asset_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL,
  source_workbook TEXT NOT NULL DEFAULT '',
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  parent_category_id INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE(source_workbook, category_name)
);

CREATE TABLE IF NOT EXISTS asset_category_policy_links (
  category_id INTEGER NOT NULL REFERENCES asset_categories(id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES depreciation_policies(id) ON DELETE CASCADE,
  match_note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(category_id, policy_id)
);

CREATE TABLE IF NOT EXISTS master_data_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('category','depreciation_policy')),
  entity_id INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'ผู้ปฏิบัติงาน',
  action TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_master_data_events_entity ON master_data_events(entity_type,entity_id,id);

CREATE TABLE IF NOT EXISTS fsn_manual_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT 'pdftotext -layout',
  UNIQUE(source_document_id, page_no)
);

CREATE TABLE IF NOT EXISTS source_document_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  UNIQUE(source_document_id, page_no)
);

CREATE TABLE IF NOT EXISTS source_columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  column_no INTEGER NOT NULL,
  source_header TEXT NOT NULL DEFAULT '',
  canonical_field TEXT NOT NULL DEFAULT '',
  mapping_note TEXT NOT NULL DEFAULT '',
  UNIQUE(source_document_id, column_no)
);

CREATE TABLE IF NOT EXISTS fsn_catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  source_page INTEGER,
  group_no TEXT NOT NULL DEFAULT '',
  group_title TEXT NOT NULL DEFAULT '',
  category_code TEXT NOT NULL DEFAULT '',
  type_code TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL DEFAULT '',
  canonical_fsn_code TEXT NOT NULL DEFAULT '',
  raw_line TEXT NOT NULL DEFAULT '',
  UNIQUE(source_document_id, source_page, category_code, type_code, item_name)
);

CREATE TABLE IF NOT EXISTS asset_fsn_matches (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  fsn_catalog_item_id INTEGER NOT NULL REFERENCES fsn_catalog_items(id) ON DELETE CASCADE,
  match_method TEXT NOT NULL,
  matched_code TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(asset_id, fsn_catalog_item_id)
);

CREATE TABLE IF NOT EXISTS import_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  warning_code TEXT NOT NULL,
  message TEXT NOT NULL,
  source_page INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  acquired_year TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ทะเบียนแล้ว',
  icon TEXT NOT NULL DEFAULT '▤',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT 'นำเข้าจากเอกสาร',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  source_row_no INTEGER,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  department_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  responsible_unit_id INTEGER REFERENCES org_units(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES asset_categories(id) ON DELETE SET NULL,
  fsn_catalog_item_id INTEGER REFERENCES fsn_catalog_items(id) ON DELETE SET NULL,
  old_asset_code TEXT NOT NULL DEFAULT '',
  maintenance_status TEXT NOT NULL DEFAULT '',
  asset_status_source TEXT NOT NULL DEFAULT '',
  asset_type TEXT NOT NULL DEFAULT '',
  fiscal_year_th TEXT NOT NULL DEFAULT '',
  acquisition_date TEXT NOT NULL DEFAULT '',
  delivery_date TEXT NOT NULL DEFAULT '',
  acquisition_method TEXT NOT NULL DEFAULT '',
  purchase_price REAL,
  gfmis_no TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  useful_life_years REAL,
  depreciation_policy_id INTEGER REFERENCES depreciation_policies(id) ON DELETE SET NULL,
  depreciation_value REAL,
  accumulated_depreciation REAL,
  net_book_value REAL,
  valuation_date TEXT NOT NULL DEFAULT '',
  remaining_days INTEGER,
  is_loaned TEXT NOT NULL DEFAULT '',
  loan_price REAL,
  latest_update TEXT NOT NULL DEFAULT '',
  delivery_note_no TEXT NOT NULL DEFAULT '',
  raw_data_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_document_id, source_row_no)
);

CREATE TABLE IF NOT EXISTS source_row_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_document_id INTEGER NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  source_row_no INTEGER NOT NULL,
  record_kind TEXT NOT NULL DEFAULT 'unmapped',
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  raw_data_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_document_id, source_row_no)
);

CREATE TABLE IF NOT EXISTS asset_acquisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  fiscal_year_th TEXT NOT NULL DEFAULT '',
  acquired_on TEXT NOT NULL DEFAULT '',
  delivered_on TEXT NOT NULL DEFAULT '',
  document_no TEXT NOT NULL DEFAULT '',
  gfmis_no TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  fund_type TEXT NOT NULL DEFAULT '',
  acquisition_method TEXT NOT NULL DEFAULT '',
  quantity REAL,
  unit_price REAL,
  total_price REAL,
  vendor_name TEXT NOT NULL DEFAULT '',
  vendor_address TEXT NOT NULL DEFAULT '',
  vendor_phone TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  warranty_end TEXT NOT NULL DEFAULT '',
  raw_data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS asset_register_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  acquisition_id INTEGER REFERENCES asset_acquisitions(id) ON DELETE SET NULL,
  organization_name TEXT NOT NULL DEFAULT '',
  department_name TEXT NOT NULL DEFAULT '',
  asset_type TEXT NOT NULL DEFAULT '',
  asset_code_printed TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL DEFAULT '',
  vendor_address TEXT NOT NULL DEFAULT '',
  vendor_phone TEXT NOT NULL DEFAULT '',
  gfmis_no TEXT NOT NULL DEFAULT '',
  po_no TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  warranty_end TEXT NOT NULL DEFAULT '',
  fiscal_year_th TEXT NOT NULL DEFAULT '',
  fund_type TEXT NOT NULL DEFAULT '',
  acquisition_method TEXT NOT NULL DEFAULT '',
  raw_data_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(asset_id, source_document_id)
);

CREATE TABLE IF NOT EXISTS asset_depreciation_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  policy_id INTEGER REFERENCES depreciation_policies(id) ON DELETE SET NULL,
  period_date TEXT NOT NULL DEFAULT '',
  useful_life_years REAL,
  monthly_depreciation REAL,
  annual_depreciation REAL,
  accumulated_depreciation REAL,
  net_book_value REAL,
  remaining_days INTEGER,
  raw_data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS survey_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT NOT NULL UNIQUE,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  asset_code TEXT NOT NULL DEFAULT '',
  asset_name TEXT NOT NULL,
  location TEXT NOT NULL,
  issue TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'ปกติ',
  requester TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  approval_required INTEGER NOT NULL DEFAULT 0,
  approval_reason TEXT NOT NULL DEFAULT '',
  requires_purchase INTEGER NOT NULL DEFAULT 0,
  requires_external INTEGER NOT NULL DEFAULT 0,
  requires_replacement INTEGER NOT NULL DEFAULT 0,
  estimate_cost REAL NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL DEFAULT '',
  final_cost_approval_required INTEGER NOT NULL DEFAULT 0,
  final_cost_status TEXT NOT NULL DEFAULT '',
  final_cost_approved_by TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '',
  work_notes TEXT NOT NULL DEFAULT '',
  actual_cost REAL NOT NULL DEFAULT 0,
  close_note TEXT NOT NULL DEFAULT '',
  data_origin TEXT NOT NULL DEFAULT 'prototype',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ticket_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sticker_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  canvas_width_mm REAL NOT NULL,
  canvas_height_mm REAL NOT NULL,
  overflow TEXT NOT NULL DEFAULT 'clip',
  elements_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sticker_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sticker_print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL REFERENCES sticker_templates(id) ON DELETE RESTRICT,
  item_count INTEGER NOT NULL DEFAULT 0,
  canvas_width_mm REAL NOT NULL,
  canvas_height_mm REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requested_by TEXT NOT NULL DEFAULT 'ผู้ปฏิบัติงาน'
);

CREATE TABLE IF NOT EXISTS sticker_print_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_job_id INTEGER NOT NULL REFERENCES sticker_print_jobs(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  label_order INTEGER NOT NULL,
  UNIQUE(print_job_id, label_order)
);

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_name TEXT NOT NULL,
  importer_version TEXT NOT NULL DEFAULT '1.0',
  source_file_count INTEGER NOT NULL DEFAULT 0,
  asset_record_count INTEGER NOT NULL DEFAULT 0,
  fsn_item_count INTEGER NOT NULL DEFAULT 0,
  depreciation_rule_count INTEGER NOT NULL DEFAULT 0,
  register_link_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- External-content trigram index accelerates substring search without storing a
-- second copy of each raw workbook row. A migration rebuilds it for old DBs.
CREATE VIRTUAL TABLE IF NOT EXISTS source_row_search USING fts5(
  raw_data_json,
  content='source_row_records',
  content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS source_row_records_search_ai AFTER INSERT ON source_row_records BEGIN
  INSERT INTO source_row_search(rowid,raw_data_json) VALUES(new.id,new.raw_data_json);
END;
CREATE TRIGGER IF NOT EXISTS source_row_records_search_ad AFTER DELETE ON source_row_records BEGIN
  INSERT INTO source_row_search(source_row_search,rowid,raw_data_json) VALUES('delete',old.id,old.raw_data_json);
END;
CREATE TRIGGER IF NOT EXISTS source_row_records_search_au AFTER UPDATE OF raw_data_json ON source_row_records BEGIN
  INSERT INTO source_row_search(source_row_search,rowid,raw_data_json) VALUES('delete',old.id,old.raw_data_json);
  INSERT INTO source_row_search(rowid,raw_data_json) VALUES(new.id,new.raw_data_json);
END;

CREATE INDEX IF NOT EXISTS idx_assets_code ON assets(code);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_gfmis ON assets(gfmis_no);
CREATE INDEX IF NOT EXISTS idx_assets_po ON assets(po_no);
CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number);
CREATE INDEX IF NOT EXISTS idx_assets_source_row ON assets(source_document_id, source_row_no);
CREATE INDEX IF NOT EXISTS idx_source_row_asset ON source_row_records(asset_id, source_document_id, source_row_no);
CREATE INDEX IF NOT EXISTS idx_acquisition_asset ON asset_acquisitions(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_asset ON asset_depreciation_snapshots(asset_id);
CREATE INDEX IF NOT EXISTS idx_register_asset ON asset_register_details(asset_id);
CREATE INDEX IF NOT EXISTS idx_tickets_asset ON tickets(asset_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_no ON tickets(ticket_no);
CREATE INDEX IF NOT EXISTS idx_fsn_codes ON fsn_catalog_items(category_code, type_code);
CREATE INDEX IF NOT EXISTS idx_fsn_item_name ON fsn_catalog_items(item_name);
CREATE INDEX IF NOT EXISTS idx_sticker_active ON sticker_templates(is_active);
