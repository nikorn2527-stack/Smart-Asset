/**
 * Default Templates — seed data for DocumentTemplate table.
 *
 * Created as part of P1-3 (Custom Export & Print Template System).
 * These templates are seeded on first run and serve as starting points
 * that users can customize via the Sticker Editor and Document Editor.
 *
 * Sticker format: StickerTemplate JSON (canvas + elements with {{variables}})
 * Document format: HTML-like sections with {{variables}}
 *
 * Variables: {{assetCode}}, {{name}}, {{brand}}, {{model}}, {{serialNumber}},
 * {{type}}, {{status}}, {{site}}, {{building}}, {{floor}}, {{department}},
 * {{departmentCode}}, {{location}}, {{purchaseDate}}, {{warrantyEnd}},
 * {{vendor}}, {{contractNo}}, {{currentAssignee}}, {{hotline}}, {{companyName}}
 */

// ── Sticker Template 1: "สติกเกอร์มาตรฐาน" (Standard Label — UDH02 style) ──
// ขนาด: 75.2mm × 36mm (A4 landscape, 3×8 = 24 stickers per sheet)
// อิงจากแอปเดิม (Apps Script Template Designer — UDH02)
// Layout: QR left-top | Company name | Asset No in box | Serial (highlight)
//         | Brand Model | MAC | Building/Floor/Dept | Notes line | Footer
export const STICKER_TEMPLATE_STANDARD = {
  name: 'สติกเกอร์มาตรฐาน (75×36mm) — แบบเดิม UDH02',
  type: 'sticker',
  category: 'label',
  content: JSON.stringify({
    canvas: { width: 75.2, height: 36, unit: 'mm' },
    overflow: 'clip',
    elements: [
      // QR code — top-left corner (encodes serial number, like old app)
      {
        id: 'el-qr',
        type: 'qr',
        x: 2, y: 2, width: 12, height: 12,
        content: '{{serialNumber}}',
        zIndex: 1,
      },
      // Company name — bold, top area (left of asset number)
      {
        id: 'el-company',
        type: 'text',
        x: 16, y: 2, width: 40, height: 4,
        content: '{{companyName}}',
        fontSize: 6, fontWeight: 700, color: '#1e293b', align: 'left',
        zIndex: 2,
      },
      // Asset No — in a box (right side, bold)
      {
        id: 'el-assetno-box',
        type: 'rect',
        x: 57, y: 1, width: 16, height: 8,
        background: '#f1f5f9', border: '#334155', borderRadius: 1,
        zIndex: 2,
      },
      {
        id: 'el-assetno-label',
        type: 'text',
        x: 58, y: 1.5, width: 14, height: 3,
        content: 'Asset No.',
        fontSize: 4, fontWeight: 400, color: '#64748b', align: 'center',
        zIndex: 3,
      },
      {
        id: 'el-assetno',
        type: 'text',
        x: 58, y: 4.5, width: 14, height: 4,
        content: '{{assetCode}}',
        fontSize: 8, fontWeight: 800, color: '#0f172a', align: 'center',
        zIndex: 3,
      },
      // Serial number — with highlight background (like old app orange highlight)
      {
        id: 'el-serial-bg',
        type: 'rect',
        x: 16, y: 6, width: 40, height: 4,
        background: '#fff3e0', border: '#ff9800', borderRadius: 0.5,
        zIndex: 2,
      },
      {
        id: 'el-serial',
        type: 'text',
        x: 17, y: 6.5, width: 38, height: 3,
        content: 'SERIAL NO.: {{serialNumber}}',
        fontSize: 5, fontWeight: 600, color: '#e65100', align: 'left',
        zIndex: 3,
      },
      // Brand + Model — bold
      {
        id: 'el-brandmodel',
        type: 'text',
        x: 16, y: 11, width: 57, height: 4,
        content: '{{brand}} {{model}}',
        fontSize: 7, fontWeight: 700, color: '#1e293b', align: 'left',
        zIndex: 4,
      },
      // MAC address (if present)
      {
        id: 'el-mac',
        type: 'text',
        x: 16, y: 15, width: 57, height: 3,
        content: 'MAC: {{mac}}',
        fontSize: 5, fontWeight: 400, color: '#64748b', align: 'left',
        zIndex: 5,
      },
      // Type/Category
      // Uses {{AssetTerminology}} so the term adapts to the org profile
      // (e.g. "ครุภัณฑ์" for gov, "ทรัพย์สิน" for private) instead of being
      // hardcoded to "ครุภัณฑ์". The variable is resolved by
      // substituteVariables() using settings.assetTerminology.
      {
        id: 'el-type',
        type: 'text',
        x: 16, y: 18, width: 30, height: 3,
        content: '{{AssetTerminology}}: {{type}}',
        fontSize: 5, fontWeight: 400, color: '#475569', align: 'left',
        zIndex: 6,
      },
      // Building / Floor
      {
        id: 'el-building',
        type: 'text',
        x: 46, y: 18, width: 27, height: 3,
        content: '{{building}} ชั้น {{floor}}',
        fontSize: 5, fontWeight: 400, color: '#475569', align: 'left',
        zIndex: 6,
      },
      // Department / Location
      {
        id: 'el-dept',
        type: 'text',
        x: 16, y: 21, width: 57, height: 3,
        content: 'แผนก: {{department}} | ที่ตั้ง: {{location}}',
        fontSize: 5, fontWeight: 400, color: '#475569', align: 'left',
        zIndex: 7,
      },
      // Notes line (dotted)
      {
        id: 'el-notes',
        type: 'text',
        x: 2, y: 25, width: 71, height: 3,
        content: 'หมายเหตุ: ............................................................',
        fontSize: 4, fontWeight: 400, color: '#94a3b8', align: 'left',
        zIndex: 8,
      },
      // Footer: hotline + LINE OA
      {
        id: 'el-footer',
        type: 'text',
        x: 2, y: 29, width: 71, height: 4,
        content: '{{companyName}} | โทร. {{hotline}} | LINE: {{lineOA}}',
        fontSize: 4, fontWeight: 400, color: '#94a3b8', align: 'center',
        zIndex: 9,
      },
      // Border rect (like old app's red border)
      {
        id: 'el-border',
        type: 'rect',
        x: 0, y: 0, width: 75.2, height: 36,
        border: '#cbd5e1', borderRadius: 1,
        zIndex: 0,
      },
    ],
  }),
}

// ── Sticker Template 2: "สติกเกอร์เต็มหน้า" (Full-Page Label) ──
// ขนาด: 100mm × 50mm (large label, 1 per small sheet)
// เหมาะสำหรับ: อุปกรณ์ใหญ่ เช่น เครื่องพิมพ์, เซิร์ฟเวอร์
export const STICKER_TEMPLATE_LARGE = {
  name: 'สติกเกอร์เต็มหน้า (100×50mm)',
  type: 'sticker',
  category: 'label',
  content: JSON.stringify({
    canvas: { width: 100, height: 50, unit: 'mm' },
    overflow: 'clip',
    elements: [
      // QR code — left side, large
      {
        id: 'el-qr',
        type: 'qr',
        x: 3, y: 3, width: 20, height: 20,
        content: '{{assetCode}}',
        zIndex: 1,
      },
      // Asset code — very big
      {
        id: 'el-assetcode',
        type: 'text',
        x: 26, y: 3, width: 71, height: 10,
        content: '{{assetCode}}',
        fontSize: 16, fontWeight: 800, color: '#0f172a', align: 'left',
        zIndex: 2,
      },
      // Site code
      {
        id: 'el-sitesite',
        type: 'text',
        x: 26, y: 13, width: 71, height: 5,
        content: '{{assetSiteCode}}',
        fontSize: 8, fontWeight: 500, color: '#475569', align: 'left',
        zIndex: 3,
      },
      // Brand + Model
      {
        id: 'el-brandmodel',
        type: 'text',
        x: 26, y: 18, width: 71, height: 5,
        content: '{{brand}} {{model}}',
        fontSize: 7, fontWeight: 400, color: '#334155', align: 'left',
        zIndex: 4,
      },
      // Serial
      {
        id: 'el-serial',
        type: 'text',
        x: 26, y: 23, width: 71, height: 4,
        content: 'S/N: {{serialNumber}}',
        fontSize: 6, fontWeight: 400, color: '#64748b', align: 'left',
        zIndex: 5,
      },
      // Location block — bottom left
      {
        id: 'el-location',
        type: 'text',
        x: 3, y: 27, width: 94, height: 8,
        content: '{{building}} ชั้น {{floor}} | {{department}} ({{departmentCode}})\n{{location}} | {{site}}',
        fontSize: 5, fontWeight: 400, color: '#475569', align: 'left',
        zIndex: 6,
      },
      // Vendor + Contract
      {
        id: 'el-vendor',
        type: 'text',
        x: 3, y: 37, width: 94, height: 4,
        content: 'ผู้จำหน่าย: {{vendor}} | สัญญา: {{contractNo}}',
        fontSize: 5, fontWeight: 400, color: '#64748b', align: 'left',
        zIndex: 7,
      },
      // Footer
      {
        id: 'el-footer',
        type: 'text',
        x: 3, y: 43, width: 94, height: 4,
        content: '{{companyName}} | โทร. {{hotline}} | {{lineOA}}',
        fontSize: 4, fontWeight: 400, color: '#94a3b8', align: 'center',
        zIndex: 8,
      },
      // Border
      {
        id: 'el-border',
        type: 'rect',
        x: 0, y: 0, width: 100, height: 50,
        border: '#cbd5e1', borderRadius: 2,
        zIndex: 0,
      },
    ],
  }),
}

// ── Sticker Template 3: "สติกเกอร์ขนาดเล็ก" (Small Label — 50×30mm) ──
// กระทัดรัด เหมาะสำหรับ: อุปกรณ์เล็ก เช่น คีย์บอร์ด, เมาส์, สแกนเนอร์
export const STICKER_TEMPLATE_SMALL = {
  name: 'สติกเกอร์ขนาดเล็ก (50×30mm)',
  type: 'sticker',
  category: 'label',
  content: JSON.stringify({
    canvas: { width: 50, height: 30, unit: 'mm' },
    overflow: 'clip',
    elements: [
      { id: 'el-header', type: 'rect', x: 0, y: 0, width: 50, height: 4, background: '#f97316', zIndex: 0 },
      { id: 'el-org', type: 'text', x: 1.5, y: 0.5, width: 47, height: 3, content: '{{orgName}}', fontSize: 7, fontWeight: 700, color: '#ffffff', align: 'center', zIndex: 1 },
      { id: 'el-qr', type: 'qr', x: 2, y: 6, width: 10, height: 10, content: '{{QrUrl}}', zIndex: 1 },
      { id: 'el-assetno-label', type: 'text', x: 14, y: 6, width: 34, height: 3, content: 'รหัส:', fontSize: 5, fontWeight: 600, color: '#64748b', align: 'left', zIndex: 1 },
      { id: 'el-assetno', type: 'text', x: 14, y: 8.5, width: 34, height: 4, content: '{{assetCode}}', fontSize: 8, fontWeight: 800, color: '#1e293b', align: 'left', zIndex: 1 },
      { id: 'el-brand-model', type: 'text', x: 14, y: 13, width: 34, height: 3, content: '{{brand}} {{model}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-serial', type: 'text', x: 14, y: 16, width: 34, height: 3, content: 'S/N: {{serialNumber}}', fontSize: 5.5, color: '#64748b', align: 'left', zIndex: 1 },
      { id: 'el-site', type: 'text', x: 14, y: 19, width: 34, height: 3, content: '{{site}} · {{building}} {{floor}}', fontSize: 5, color: '#94a3b8', align: 'left', zIndex: 1 },
      { id: 'el-footer', type: 'rect', x: 0, y: 27, width: 50, height: 3, background: '#f1f5f9', zIndex: 0 },
      { id: 'el-date', type: 'text', x: 1, y: 27.3, width: 48, height: 2.5, content: '{{AssetTerminology}} · {{purchaseDate}}', fontSize: 4.5, color: '#94a3b8', align: 'center', zIndex: 1 },
    ],
  }),
  isDefault: false,
}

// ── Sticker Template 4: "สติกเกอร์กลาง" (Medium Label — 70×40mm) ──
// ขนาดกลาง พอดีสำหรับ: มอนิเตอร์, คอมพิวเตอร์, อุปกรณ์เครือข่าย
export const STICKER_TEMPLATE_MEDIUM = {
  name: 'สติกเกอร์กลาง (70×40mm)',
  type: 'sticker',
  category: 'label',
  content: JSON.stringify({
    canvas: { width: 70, height: 40, unit: 'mm' },
    overflow: 'clip',
    elements: [
      { id: 'el-header', type: 'rect', x: 0, y: 0, width: 70, height: 5, background: '#f97316', zIndex: 0 },
      { id: 'el-org', type: 'text', x: 1.5, y: 0.8, width: 40, height: 3.5, content: '{{orgName}}', fontSize: 8, fontWeight: 800, color: '#ffffff', align: 'left', zIndex: 1 },
      { id: 'el-asset-term', type: 'text', x: 42, y: 0.8, width: 27, height: 3.5, content: '{{AssetTerminology}}', fontSize: 6, fontWeight: 600, color: '#ffffff', align: 'right', zIndex: 1 },
      { id: 'el-qr', type: 'qr', x: 2, y: 7, width: 14, height: 14, content: '{{QrUrl}}', zIndex: 1 },
      { id: 'el-assetno-label', type: 'text', x: 18, y: 7, width: 50, height: 3, content: 'รหัสทรัพย์สิน', fontSize: 5, fontWeight: 600, color: '#64748b', align: 'left', zIndex: 1 },
      { id: 'el-assetno', type: 'text', x: 18, y: 9.5, width: 50, height: 5, content: '{{assetCode}}', fontSize: 10, fontWeight: 800, color: '#f97316', align: 'left', zIndex: 1 },
      { id: 'el-brand-model', type: 'text', x: 18, y: 15, width: 50, height: 4, content: '{{brand}} {{model}}', fontSize: 7, fontWeight: 600, color: '#1e293b', align: 'left', zIndex: 1 },
      { id: 'el-serial', type: 'text', x: 18, y: 19, width: 50, height: 3, content: 'S/N: {{serialNumber}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-site', type: 'text', x: 18, y: 22.5, width: 50, height: 3, content: '{{site}} · {{building}} ช.{{floor}}', fontSize: 6, color: '#64748b', align: 'left', zIndex: 1 },
      { id: 'el-dept', type: 'text', x: 18, y: 25.5, width: 50, height: 3, content: '{{department}}', fontSize: 5.5, color: '#94a3b8', align: 'left', zIndex: 1 },
      { id: 'el-warranty', type: 'text', x: 18, y: 28.5, width: 50, height: 3, content: 'รับประกัน: {{warrantyEnd}}', fontSize: 5.5, color: '#94a3b8', align: 'left', zIndex: 1 },
      { id: 'el-footer', type: 'rect', x: 0, y: 36, width: 70, height: 4, background: '#f1f5f9', zIndex: 0 },
      { id: 'el-date', type: 'text', x: 1, y: 36.5, width: 68, height: 3, content: '{{AssetTerminology}} · ซื้อ {{purchaseDate}}', fontSize: 5, color: '#94a3b8', align: 'center', zIndex: 1 },
    ],
  }),
  isDefault: false,
}

// ── Sticker Template 5: "สติกเกอร์รายละเอียดครบ" (Detailed Label — 100×50mm) ──
// แสดงข้อมูลครบทุกฟิลด์ เหมาะสำหรับ: เครื่องพิมพ์, เซิร์ฟเวอร์, อุปกรณ์มีค่า
export const STICKER_TEMPLATE_DETAILED = {
  name: 'สติกเกอร์รายละเอียดครบ (100×50mm)',
  type: 'sticker',
  category: 'label',
  content: JSON.stringify({
    canvas: { width: 100, height: 50, unit: 'mm' },
    overflow: 'clip',
    elements: [
      { id: 'el-header', type: 'rect', x: 0, y: 0, width: 100, height: 6, background: '#f97316', zIndex: 0 },
      { id: 'el-org', type: 'text', x: 2, y: 1, width: 60, height: 4, content: '{{orgName}}', fontSize: 9, fontWeight: 800, color: '#ffffff', align: 'left', zIndex: 1 },
      { id: 'el-term', type: 'text', x: 62, y: 1, width: 37, height: 4, content: '{{AssetTerminology}}', fontSize: 7, fontWeight: 600, color: '#ffffff', align: 'right', zIndex: 1 },
      { id: 'el-qr', type: 'qr', x: 3, y: 9, width: 18, height: 18, content: '{{QrUrl}}', zIndex: 1 },
      { id: 'el-assetno-label', type: 'text', x: 24, y: 9, width: 73, height: 3, content: 'รหัสทรัพย์สิน', fontSize: 5, fontWeight: 600, color: '#64748b', align: 'left', zIndex: 1 },
      { id: 'el-assetno', type: 'text', x: 24, y: 12, width: 73, height: 6, content: '{{assetCode}}', fontSize: 12, fontWeight: 800, color: '#f97316', align: 'left', zIndex: 1 },
      { id: 'el-brand-model', type: 'text', x: 24, y: 19, width: 73, height: 4, content: '{{brand}} {{model}}', fontSize: 8, fontWeight: 600, color: '#1e293b', align: 'left', zIndex: 1 },
      { id: 'el-serial', type: 'text', x: 24, y: 24, width: 73, height: 3, content: 'S/N: {{serialNumber}}', fontSize: 6.5, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-site', type: 'text', x: 3, y: 30, width: 45, height: 3, content: 'สาขา: {{site}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-loc', type: 'text', x: 3, y: 33, width: 45, height: 3, content: '{{building}} ช.{{floor}} {{location}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-dept', type: 'text', x: 3, y: 36, width: 45, height: 3, content: '{{department}} ({{departmentCode}})', fontSize: 5.5, color: '#94a3b8', align: 'left', zIndex: 1 },
      { id: 'el-warranty', type: 'text', x: 52, y: 30, width: 45, height: 3, content: 'รับประกัน: {{warrantyEnd}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-purchase', type: 'text', x: 52, y: 33, width: 45, height: 3, content: 'ซื้อ: {{purchaseDate}} · ฿{{purchasePrice}}', fontSize: 6, color: '#475569', align: 'left', zIndex: 1 },
      { id: 'el-ip', type: 'text', x: 52, y: 36, width: 45, height: 3, content: 'IP: {{ip}} · MAC: {{mac}}', fontSize: 5.5, color: '#94a3b8', align: 'left', zIndex: 1 },
      { id: 'el-footer', type: 'rect', x: 0, y: 46, width: 100, height: 4, background: '#f1f5f9', zIndex: 0 },
      { id: 'el-footer-text', type: 'text', x: 1, y: 46.5, width: 98, height: 3, content: '{{vendor}} · {{contractNo}}', fontSize: 5, color: '#94a3b8', align: 'center', zIndex: 1 },
    ],
  }),
  isDefault: false,
}

// ── Work Order Template: "ใบแจ้งซ่อมมาตรฐาน" ──
// HTML-based document template with {{variables}}
export const WO_TEMPLATE_STANDARD = {
  name: 'ใบแจ้งซ่อมมาตรฐาน',
  type: 'work-order',
  category: 'form',
  content: JSON.stringify({
    format: 'A4',
    orientation: 'portrait',
    sections: [
      {
        type: 'header',
        title: 'ใบแจ้งซ่อม',
        fields: [
          { label: 'เลขที่', variable: '{{woNumber}}' },
          { label: 'วันที่แจ้ง', variable: '{{createdAt}}' },
          { label: 'สถานะ', variable: '{{status}}' },
          { label: 'ความเร่งด่วน', variable: '{{priority}}' },
        ],
      },
      {
        type: 'device-info',
        title: 'ข้อมูลอุปกรณ์',
        fields: [
          { label: 'รหัสทรัพย์สิน', variable: '{{assetCode}}' },
          { label: 'ชื่ออุปกรณ์', variable: '{{deviceName}}' },
          { label: 'ยี่ห้อ/รุ่น', variable: '{{brandModel}}' },
          { label: 'Serial No.', variable: '{{serialNumber}}' },
          { label: 'สาขา', variable: '{{site}}' },
          { label: 'ที่ตั้ง', variable: '{{location}}' },
        ],
      },
      {
        type: 'problem',
        title: 'รายละเอียดปัญหา',
        fields: [
          { label: 'หัวข้อ', variable: '{{subject}}' },
          { label: 'รายละเอียด', variable: '{{description}}' },
        ],
      },
      {
        type: 'assignment',
        title: 'การมอบหมาย',
        fields: [
          { label: 'ผู้รับผิดชอบ', variable: '{{assignedTo}}' },
          { label: 'วันที่มอบหมาย', variable: '{{assignedAt}}' },
        ],
      },
      {
        type: 'footer',
        title: 'ลงนาม',
        fields: [
          { label: 'ผู้แจ้ง', variable: '{{reporterName}}' },
          { label: 'เบอร์โทร', variable: '{{reporterPhone}}' },
          { label: 'ผู้รับงาน', variable: '{{assignedTo}}' },
        ],
      },
    ],
  }),
}

// ── Stock Out Template: "ใบเบิกมาตรฐาน" ──
export const STOCK_OUT_TEMPLATE_STANDARD = {
  name: 'ใบเบิกมาตรฐาน',
  type: 'stock-out',
  category: 'form',
  content: JSON.stringify({
    format: 'A4',
    orientation: 'portrait',
    sections: [
      {
        type: 'header',
        title: 'ใบเบิกสินค้า',
        fields: [
          { label: 'เลขที่', variable: '{{txnNumber}}' },
          { label: 'วันที่', variable: '{{createdAt}}' },
          { label: 'ประเภท', variable: '{{type}}' },
        ],
      },
      {
        type: 'requester',
        title: 'ผู้เบิก',
        fields: [
          { label: 'ชื่อ', variable: '{{requester}}' },
          { label: 'แผนก', variable: '{{department}}' },
          { label: 'วัตถุประสงค์', variable: '{{purpose}}' },
        ],
      },
      {
        type: 'items-table',
        title: 'รายการเบิก',
        columns: ['รหัส', 'ชื่อสินค้า', 'จำนวน', 'หน่วย'],
        variableMappings: ['{{productCode}}', '{{productName}}', '{{quantity}}', '{{unit}}'],
      },
      {
        type: 'footer',
        title: 'ลงนาม',
        fields: [
          { label: 'ผู้เบิก', variable: '{{requester}}' },
          { label: 'ผู้อนุมัติ', variable: '{{approver}}' },
          { label: 'ผู้จ่าย', variable: '{{issuedBy}}' },
        ],
      },
    ],
  }),
}

// ── Stock In Template: "ใบรับมาตรฐาน" ──
export const STOCK_IN_TEMPLATE_STANDARD = {
  name: 'ใบรับสินค้ามาตรฐาน',
  type: 'stock-in',
  category: 'form',
  content: JSON.stringify({
    format: 'A4',
    orientation: 'portrait',
    sections: [
      {
        type: 'header',
        title: 'ใบรับสินค้าเข้า',
        fields: [
          { label: 'เลขที่', variable: '{{txnNumber}}' },
          { label: 'วันที่', variable: '{{createdAt}}' },
        ],
      },
      {
        type: 'supplier',
        title: 'ผู้จำหน่าย',
        fields: [
          { label: 'บริษัท', variable: '{{vendor}}' },
          { label: 'ใบสั่งซื้อ', variable: '{{purchaseOrderNo}}' },
        ],
      },
      {
        type: 'items-table',
        title: 'รายการรับ',
        columns: ['รหัส', 'ชื่อสินค้า', 'จำนวน', 'หน่วย', 'ราคา/หน่วย'],
        variableMappings: ['{{productCode}}', '{{productName}}', '{{quantity}}', '{{unit}}', '{{unitCost}}'],
      },
      {
        type: 'footer',
        title: 'ลงนาม',
        fields: [
          { label: 'ผู้ส่ง', variable: '{{vendor}}' },
          { label: 'ผู้รับ', variable: '{{receiver}}' },
        ],
      },
    ],
  }),
}

// ── Purchase Order Template: "ใบสั่งซื้อมาตรฐาน" ──
export const PO_TEMPLATE_STANDARD = {
  name: 'ใบสั่งซื้อมาตรฐาน',
  type: 'purchase-order',
  category: 'form',
  content: JSON.stringify({
    format: 'A4',
    orientation: 'portrait',
    sections: [
      {
        type: 'header',
        title: 'ใบสั่งซื้อ',
        fields: [
          { label: 'เลขที่', variable: '{{poNumber}}' },
          { label: 'วันที่', variable: '{{createdAt}}' },
          { label: 'สถานะ', variable: '{{status}}' },
        ],
      },
      {
        type: 'supplier',
        title: 'ผู้จำหน่าย',
        fields: [
          { label: 'ชื่อบริษัท', variable: '{{supplierName}}' },
          { label: 'ที่อยู่', variable: '{{supplierAddress}}' },
          { label: 'เบอร์โทร', variable: '{{supplierPhone}}' },
        ],
      },
      {
        type: 'items-table',
        title: 'รายการสั่งซื้อ',
        columns: ['ลำดับ', 'รหัส', 'ชื่อสินค้า', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'ราคารวม'],
        variableMappings: ['{{index}}', '{{productCode}}', '{{productName}}', '{{quantity}}', '{{unit}}', '{{unitCost}}', '{{total}}'],
      },
      {
        type: 'summary',
        title: 'สรุปยอด',
        fields: [
          { label: 'มูลค่ารวม', variable: '{{totalValue}}' },
          { label: 'ภาษี (7%)', variable: '{{vat}}' },
          { label: 'ยอดสุทธิ', variable: '{{grandTotal}}' },
        ],
      },
      {
        type: 'footer',
        title: 'ลงนาม',
        fields: [
          { label: 'ผู้สั่งซื้อ', variable: '{{orderedBy}}' },
          { label: 'ผู้อนุมัติ', variable: '{{approvedBy}}' },
        ],
      },
    ],
  }),
}

// ── PDF Report Template: "รายงานสรุปมาตรฐาน" ──
export const PDF_REPORT_TEMPLATE_STANDARD = {
  name: 'รายงานสรุปมาตรฐาน',
  type: 'pdf',
  category: 'report',
  content: JSON.stringify({
    format: 'A4',
    orientation: 'landscape',
    sections: [
      {
        type: 'header',
        title: '{{reportTitle}}',
        fields: [
          { label: 'รอบระยะ', variable: '{{rangeLabel}}' },
          { label: 'สาขา', variable: '{{siteLabel}}' },
          { label: 'วันที่ออกรายงาน', variable: '{{generatedAt}}' },
        ],
      },
      {
        type: 'summary-cards',
        title: 'ภาพรวม',
        fields: [
          { label: 'อุปกรณ์ทั้งหมด', variable: '{{totalDevices}}' },
          { label: 'ใช้งานอยู่', variable: '{{activeCount}}' },
          { label: 'ส่งซ่อม', variable: '{{repairCount}}' },
          { label: 'กระดาษเดือนนี้', variable: '{{paperThisMonth}}' },
        ],
      },
      {
        type: 'table',
        title: 'รายละเอียด',
        columns: '{{tableColumns}}',
        rows: '{{tableRows}}',
      },
      {
        type: 'footer',
        title: '',
        fields: [
          { label: 'ออกรายงานโดย', variable: '{{generatedBy}}' },
          { label: 'หน่วยงาน', variable: '{{companyName}}' },
        ],
      },
    ],
  }),
}

// ── All default templates ──
export const ALL_DEFAULT_TEMPLATES = [
  STICKER_TEMPLATE_STANDARD,
  STICKER_TEMPLATE_LARGE,
  STICKER_TEMPLATE_SMALL,
  STICKER_TEMPLATE_MEDIUM,
  STICKER_TEMPLATE_DETAILED,
  WO_TEMPLATE_STANDARD,
  STOCK_OUT_TEMPLATE_STANDARD,
  STOCK_IN_TEMPLATE_STANDARD,
  PO_TEMPLATE_STANDARD,
  PDF_REPORT_TEMPLATE_STANDARD,
]
