# เอกสารอ้างอิง: การแปลงข้อมูลจาก 3 แอปเดิม → ระบบใหม่

**วัตถุประสงค์:** เอกสารนี้แปลจากไฟล์โค้ด `src/lib/csv-field-mapping.ts` (914 บรรทัด) ให้อ่านง่าย เพื่อให้เจ้าของระบบและทีมงานในอนาคต **ตรวจสอบได้เองว่าคอลัมน์ไหนในแอปเดิม แปลงมาเป็นฟิลด์ไหนในระบบใหม่** โดยไม่ต้องเปิดโค้ด

**⚠️ สำคัญ:** ถ้ามีการแก้ไข mapping ในโค้ด (`csv-field-mapping.ts`) ต้องอัปเดตเอกสารนี้ตามด้วยเสมอ ไม่งั้นเอกสารนี้จะไม่ตรงกับของจริง — แนะนำเพิ่มเป็น checklist ตอนรีวิว PR ที่แตะไฟล์นี้

**การรับประกันจากเจ้าของระบบ (บันทึกไว้เป็นหลักฐาน):** หัวตารางของทั้ง 3 แอปเดิมไม่เคยเปลี่ยนแปลงตั้งแต่เริ่มพัฒนาแอปนี้ (ยืนยันโดยเจ้าของระบบ วันที่ 2026-09-07)

---

## ชื่อแท็บจริงของทั้ง 3 แอป (ใช้ตอนตั้งค่า Google Sheets API)

### แอป 1: IT-Asset-Management 📊

| ชื่อแท็บ (Sheet tab) | คำอธิบาย | จำนวนคอลัมน์ | Mapping key | ตารางในระบบใหม่ |
|---|---|---|---|---|
| `All_Devices` | รายการอุปกรณ์ทั้งหมด | 28 | `device` | `Device` |
| `Meter_Readings` | ประวัติการจดมิเตอร์ | 21 | `meterReading` | `MeterReading` |
| `Location_History` | ประวัติการย้ายอุปกรณ์ | 21 | `deviceTransfer` | `DeviceTransfer` |
| `User_Permissions` | ผู้ใช้และสิทธิ์ | 11 | `user` | `User` |
| `App_Settings` | ตั้งค่าระบบแบบ key-value | 4 | `appSetting` | `AppSetting` |
| `Master_Items` | ข้อมูลมาตรฐาน (dropdown ต่างๆ) | 10 | `masterItem` | `MasterItem` |
| `Site_Attributes` | สาขาและอัตราค่ากระดาษ | 6 | `site` | `Site` / `SiteRate` |

### แอป 2: Services (แจ้งซ่อม) 🔧

| ชื่อแท็บ (Sheet tab) | คำอธิบาย | Mapping key | ตารางในระบบใหม่ |
|---|---|---|---|
| `Data` (เก็บเป็น WorkOrders) | ใบงานแจ้งซ่อม — แอปเดิมเก็บเป็น JSON ในเซลล์เดียว ตอน export เป็น CSV จะ flatten JSON key ออกมาเป็นคอลัมน์ | `workOrder` | `WorkOrder` |

### แอป 3: Stock 📦

| ชื่อแท็บ (Sheet tab) | คำอธิบาย | จำนวนคอลัมน์ | Mapping key | ตารางในระบบใหม่ |
|---|---|---|---|---|
| `Products` | สินค้าคงคลัง | 9 | `stockItem` | `StockItem` |
| `StockIn` | รับสินค้าเข้า | 12 | `stockIn` | `StockTransaction` (type=IN) |
| `StockOut` | เบิกสินค้าออก | 15 | `stockOut` | `StockTransaction` (type=OUT) |
| `PurchaseOrders` | ใบสั่งซื้อ | 13 | `purchaseOrder` | `PurchaseOrder` |

---

## ตารางแปลงฟิลด์แบบละเอียด (ทุกคอลัมน์)

### 1. `All_Devices` → `Device`

| คอลัมน์เดิม (Apps Script) | ฟิลด์ใหม่ (ระบบนี้) | หมายเหตุ |
|---|---|---|
| `asset_no` | `assetCode` | ใช้เป็น unique key หลักในการจับคู่ |
| `device_type` | `type` | |
| `serial` | `serialNumber` | |
| `department_code` | `departmentCode` | |
| `contract_no` | `contractNo` | สัญญาบำรุงรักษา |
| `remote_id` | `remoteId` | |
| `updated_at` | `updatedAt` | |
| `updated_by` | `updatedBy` | |
| `install_date` | `installDate` | วันติดตั้ง |
| `uninstall_date` | `uninstallDate` | วันถอดถอน |
| `warranty_end` | `warrantyEnd` | |
| `device_group` | `deviceGroup` | |
| `cost_center` | `costCenter` | |
| `meter_required` | `meterRequired` | |
| `meter_mode` | `meterMode` | |
| `asset_site_code` | `assetSiteCode` | รหัสประจำสาขา |
| `brand`, `model`, `status`, `site`, `department`, `location`, `building`, `floor`, `ip`, `mac`, `remark`, `vendor` | ชื่อเดียวกัน | ไม่มีการเปลี่ยนชื่อ (1:1) |

**หมายเหตุพิเศษ:** แอปเดิมไม่มีคอลัมน์ `name` (ชื่ออุปกรณ์) — ระบบใหม่จะสร้างขึ้นเองจาก `"{brand} {model}"` ตอนนำเข้าข้อมูล

### 2. `Meter_Readings` → `MeterReading`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `reading_id` | `id` | ใช้เป็น dedup key |
| `asset_no` | `deviceId` | **ต้อง lookup**: หาค่านี้ผ่าน `assetCode` ก่อน แล้วค่อยแปลงเป็น `Device.id` |
| `reading_date` | `readingDate` | |
| `reading_month` | `readingMonth` | |
| `meter_bw` / `meter_color` | `meterBw` / `meterColor` | |
| `pages_bw` / `pages_color` | `pagesBw` / `pagesColor` | |
| `prev_meter_bw` / `prev_meter_color` | `prevMeterBw` / `prevMeterColor` | |
| `reading_type` | `readingType` | |
| `read_by` | `readBy` | |
| `remark` | `remark` | |
| `site_at_reading`, `building_at_reading`, `floor_at_reading`, `department_at_reading` | ชื่อเดียวกัน | snapshot ตำแหน่ง ณ วันที่จดมิเตอร์ |

### 3. `Location_History` → `DeviceTransfer`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `Log_ID` | `id` | |
| `Asset_No` | `deviceId` | **ต้อง lookup** ผ่าน `assetCode` |
| `Move_Date` | `transferDate` | |
| `From_Site` / `To_Site` | `fromSite` / `toSite` | |
| `From_Department` / `To_Department` | `fromDept` / `toDept` | |
| `From_DepartmentCode` / `To_DepartmentCode` | `fromDeptCode` / `toDeptCode` | คอลัมน์นี้อาจไม่มีในชีตเก่าบางไฟล์ |
| `From_Building` / `To_Building` | `fromBuilding` / `toBuilding` | |
| `From_Floor` / `To_Floor` | `fromFloor` / `toFloor` | |
| `From_Location` / `To_Location` | `fromLocation` / `toLocation` | |
| `Moved_By` | `movedBy` | |
| `Remark` | `reason` | **ชื่อเปลี่ยน** — Remark เดิม กลายเป็น reason ในระบบใหม่ |

### 4. `User_Permissions` → `User`

| คอลัมน์เดิม | ฟิลด์ใหม่ |
|---|---|
| `Email`, `Role`, `Active`, `Name`, `Username`, `PasswordHash`, `Remark`, `UpdatedAt`, `LastLoginAt` | ชื่อเดียวกัน (ตัวพิมพ์เล็ก) |
| `Allowed_Sites` | `allowedSites` |

### 5. `App_Settings` → `AppSetting`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `Key` | `key` | |
| `Value` | `value` | |
| `Description` | `remark` | เก็บคำอธิบายไว้ในฟิลด์ remark |
| `UpdatedAt` | `updatedAt` | |

### 6. `Master_Items` → `MasterItem`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `CategoryKey` | `category` | |
| `ItemID` | `code` | |
| `Value` | `label` | |
| `GroupName` / `ParentRef` | `parentRef` | **ทั้งสองคอลัมน์แม็พไปฟิลด์เดียวกัน** |
| `DisplayLabel` | `displayLabel` | |
| `SiteCode` / `AllowedSites` | `siteCode` | **ทั้งสองคอลัมน์แม็พไปฟิลด์เดียวกัน** |
| `Active` | `active` | |
| `DepartmentCode` | `displayLabel` | เก็บเป็นข้อมูลเสริมใน displayLabel |

### 7. `Site_Attributes` → `Site` + `SiteRate`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `Site_Code` | `code` | |
| `SiteName` | `name` | |
| `LineOA` / `Hotline` | `phone` | **ทั้งสองคอลัมน์แม็พไปฟิลด์เดียวกัน (phone)** |
| `PaperRateBW` | `bwRate` | |
| `PaperRateColor` | `colorRate` | |

### 8. `Products` (Stock) → `StockItem`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `ProductCode` | `productCode` | |
| `ProductName` | `productName` | |
| `CurrentStock` | `quantity` | |
| `Unit` | `unit` | |
| `UnitPrice` | `unitCost` | |
| `TotalValue` | _(ข้าม)_ | คำนวณใหม่ตอนนำเข้า ไม่ใช้ค่าเดิม |
| `ReorderPoint` | `minQuantity` | |
| `LastUpdated` | `updatedAt` | |
| `Status` | `active` | ค่า "Active"/"Inactive" แปลงเป็น true/false |

### 9. `StockIn` → `StockTransaction` (type=IN)

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `ReceiptNo` | `txnNumber` | |
| `Date` | `txnDate` | |
| `ProductCode` | `stockItemId` | **ต้อง lookup** ผ่าน productCode |
| `ProductName` | _(ข้าม)_ | ใช้แค่ตอน validate |
| `Quantity` | `quantity` | |
| `UnitPrice` | `cost` | |
| `Supplier` | `vendor` | |
| `Receiver` | `performedBy` | |
| `Remark` | `remark` | |
| `PurchaseOrderNo` | `purchaseOrderId` | **ต้อง lookup** ผ่าน poNumber |

### 10. `StockOut` → `StockTransaction` (type=OUT)

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `IssueNo` | `txnNumber` | |
| `Date` | `txnDate` | |
| `ProductCode` | `stockItemId` | **ต้อง lookup** |
| `Quantity` | `quantity` | |
| `Requester` | `requester` | |
| `Department` | `department` | |
| `Purpose` | `purpose` | |
| `Approver` | `approver` | |
| `ApprovedAt` | `approvedAt` | |
| `WorkOrderNo` (หรือคำไทย: `เลขที่งาน`/`เลขงาน`/`หมายเลขงาน`) | `workOrderNo` | รองรับหลายชื่อคอลัมน์ที่หมายถึงสิ่งเดียวกัน (ดูหมายเหตุด้านล่าง) |

### 11. `PurchaseOrders` → `PurchaseOrder`

| คอลัมน์เดิม | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `PurchaseOrderNo` | `poNumber` | |
| `OrderDate` | `orderDate` | |
| `ProductCode` | `stockItemId` | **ต้อง lookup** |
| `QuantityOrdered` | `quantityOrdered` | |
| `UnitPrice` | `unitPrice` | |
| `TotalValue` | `totalValue` | |
| `Supplier` | `supplier` | |
| `Status` | `status` | |
| `QuantityReceived` | `quantityReceived` | |
| `CreatedBy` | `createdBy` | |

### 12. `Data` (Services WorkOrders) → `WorkOrder`

แอปเดิมเก็บใบงานแต่ละใบเป็น JSON ก้อนเดียวในเซลล์ ตอน export เป็น CSV ระบบจะ flatten JSON key ออกมาเป็นคอลัมน์ — คอลัมน์ที่ได้จึงตรงกับชื่อ field ใน JSON เดิมเป๊ะ:

| คอลัมน์เดิม (JSON key) | ฟิลด์ใหม่ | หมายเหตุ |
|---|---|---|
| `id` | `requestId` | ใช้เป็น dedup ID |
| `legacy_job_no` (หรือคำไทย: `เลขที่งาน`/`เลขงาน`/`หมายเลขงาน`) | `legacyJobNo` | เก็บเลขใบงานเดิมแยกจากเลขระบบใหม่ |
| `subject` | `subject` | |
| `status` | `status` | **ต้องแปลงค่า** (ดูตาราง Status Mapping ด้านล่าง) |
| `building`, `location`, `details` | ชื่อเดียวกัน | |
| `external_meta` | `externalMeta` | |
| `reporter_name` | `reporterName` | |
| `tel` | `tel` | |
| `employee_code` | `employeeCode` | |
| `submission_source` | `submissionSource` | |
| `pic_before` / `pic_onsite` / `pic_after` | `picBefore` / `picOnsite` / `picAfter` | รูปถ่ายประกอบงาน |
| `details_admin` | `detailsAdmin` | |
| `date_admin` | `dateAdmin` | |
| `accept_status` | `acceptStatus` | |
| `edit_unlock_active/by/at/note` | `editUnlockActive/By/At/Note` | |
| `work_completed_at` / `closed_at` / `canceled_at` | ชื่อเดียวกัน (camelCase) | |
| `priority` | `priority` | |
| `assigned_to/by/at`, `assignment_note` | `assignedTo/By/At`, `assignmentNote` | |
| `trackable` | `trackable` | |
| `created_at` / `updated_at` | `createdAt` / `updatedAt` | |

**Status Mapping (WorkOrder):** แอปเดิมใช้ข้อความไทยพร้อม emoji นำหน้า ระบบจะแปลงเป็น enum ภาษาอังกฤษ:

| ค่าเดิม | ค่าใหม่ |
|---|---|
| 🟠รอดำเนินการ | `PENDING` |
| 🔵สำรวจหน้างาน/แก้ไข | `IN_PROGRESS` |
| 🟡รอเบิกอะไหล่ | `WAITING_PARTS` |
| 🟢จบงาน | `COMPLETED` |
| ⚫ยกเลิกงาน | `CANCELLED` |

(ระบบรองรับด้วยว่าถ้าส่งมาเป็นข้อความไทยไม่มี emoji หรือเป็นภาษาอังกฤษอยู่แล้ว ก็แปลงถูกต้องเช่นกัน)

---

## หลักการทำงานของระบบจับคู่คอลัมน์ (สำหรับอ้างอิงทางเทคนิค)

1. **จับคู่แบบตรงตัวก่อน** (case-sensitive ตามที่เขียนในตารางด้านบน)
2. **ถ้าไม่ตรง ลองจับคู่แบบ "normalized"** — ตัดตัวพิมพ์ใหญ่/เล็ก ขีดล่าง ขีดกลาง ช่องว่างออกหมดก่อนเทียบ เช่น `asset_no`, `Asset No`, `ASSETNO`, `asset-no` ถือว่าเป็นคอลัมน์เดียวกัน
3. **ถ้ายังไม่เจอ** → คอลัมน์นั้นจะถูกขึ้นบัญชีเป็น "unmapped" และ**แสดงเตือนในหน้า Preview ของระบบทันที** (ไม่ใช่ล้มเหลวแบบเงียบๆ) — เปิดดูได้ที่หน้า Sync Preview ในระบบก่อน sync จริงทุกครั้ง

**ข้อจำกัดที่ต้องรู้:** ระบบจับคู่ได้แค่ความต่างด้านรูปแบบ (ตัวพิมพ์/ขีด/เว้นวรรค) เท่านั้น **ถ้าเปลี่ยนชื่อคอลัมน์จริงๆ** (เช่น `asset_no` → `assetNumber` หรือเปลี่ยนเป็นภาษาไทย) ระบบจะจับคู่ไม่ได้อัตโนมัติ ต้องมาอัปเดตตารางในเอกสารนี้ + โค้ด `csv-field-mapping.ts` เอง — แต่เนื่องจากเจ้าของระบบยืนยันว่าหัวตารางไม่เคยเปลี่ยน ความเสี่ยงนี้จึงต่ำมาก

---

*เอกสารนี้แปลจาก `src/lib/csv-field-mapping.ts` เมื่อ 2026-09-07 — หากแก้โค้ดไฟล์นี้ในอนาคต ให้อัปเดตเอกสารนี้ตามด้วยเสมอ*
