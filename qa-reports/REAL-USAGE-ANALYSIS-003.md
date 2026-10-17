# 📊 วิเคราะห์ทรัพยากรจากข้อมูลการใช้งานจริง

| ฟิลด์ | ค่า |
|------|-----|
| **Document ID** | REAL-USAGE-ANALYSIS-003 |
| **วันที่** | 2026-08-29 |
| **แหล่งข้อมูล** | ข้อมูลการใช้งานจริงจาก User (Project Owner) |
| **Project** | ITAM-NextJS (Vercel Hobby + Supabase Free ITAM-DB) |

---

## 📊 ข้อมูลการใช้งานจริงจาก User

| # | ประเภท | ปริมาณ | หมายเหตุ |
|---|--------|-------|---------|
| 1 | ผู้ใช้งานจริง | **5 คน** (อนาคต 10 คน) | ระบบเสร็จแล้วจะเพิ่ม |
| 2 | Devices เพิ่ม/ปี | **500-600 เครื่อง** | ทยอยจำหน่าย + เข้าแทน |
| 3 | Work Orders/วัน | **30-50 เคส** | เฉลี่ย 40/วัน |
| 4 | รูป Work Orders/เคส | **สูงสุด 27 รูป** (จำกัด) | ปัจจุบันใช้จริง ~6 รูป |
| 5 | งานสต๊อก/เดือน | **≤10 ใบ** | รับ/เบิก/สั่งซื้อ |
| 6 | จดมิเตอร์/เดือน | **800-900 รายการ** | ทำทุกเดือน |
| 7 | จัดการอุปกรณ์/เดือน | **≤100 รายการ** | ย้าย/ถอน/จำหน่าย |

---

## 📈 การเติบโตต่อปี (คำนวณจากข้อมูลจริง)

| Resource | ต่อเดือน | ต่อปี | 3 ปี |
|----------|--------|------|------|
| Devices | +46 | **+550** | +1,650 |
| Work Orders | 1,000 | **+12,000** | +36,000 |
| Meter Readings | 850 | **+10,200** | +30,600 |
| Stock Transactions | 10 | +120 | +360 |
| Device Transfers | 100 | +1,200 | +3,600 |
| รูป Work Orders | 6,000 | **+72,000** | +216,000 |

---

## 💾 DB Storage Projection (ไม่รวมรูป)

| ช่วง | Records รวม | DB Size | % of 500MB Free |
|------|-----------|---------|-----------------|
| **ปัจจุบัน** | 24,688 | 40.5 MB | 8.1% ✅ |
| **ปีที่ 1** | ~57,000 | 89.8 MB | 18.0% ✅ |
| **ปีที่ 2** | ~87,000 | 139.1 MB | 27.8% ✅ |
| **ปีที่ 3** | ~117,000 | 188.4 MB | 37.7% ✅ |

> ✅ **DB storage ปลอดภัย 5+ ปี** — ไม่ต้อง upgrade

---

## 🖼️ รูปภาพ Work Orders — ความเสี่ยงหลัก!

### คำนวณ:
- รูป/เคส: 6 รูป (ใช้จริง)
- WO/เดือน: 1,000
- **รูป/เดือน: 6,000**
- รูป/ปี: **72,000**
- ขนาดเฉลี่ย: ~200KB/รูป (JPEG)

### ผลกระทบตามแต่ละ storage:

| Storage | ปี 1 | ปี 2 | ปี 3 | Limit | สถานะ |
|---------|------|------|------|-------|------|
| **DB (base64)** | 13.7 GB | 27.5 GB | 41.2 GB | 500 MB | ❌ **เกิน 27x ในปีแรก!** |
| **Supabase Storage** | 13.7 GB | 27.5 GB | 41.2 GB | 1 GB | ❌ **เกิน 13x ในปีแรก!** |
| **Vercel Blob** | 13.7 GB | 27.5 GB | 41.2 GB | 1 GB | ❌ **เกิน 13x ในปีแรก!** |

> 🔴 **รูปภาพเป็นปัญหาใหญ่ที่สุด** — ทุก free tier ไม่พอ ต้องมีแผนจริงจัง

---

## 🌐 Bandwidth + Egress + Functions (10 users)

### Vercel Bandwidth (limit 100GB/เดือน):
| Usage Pattern | Calls/เดือน | Bandwidth | % |
|--------------|------------|-----------|---|
| Light (50 calls/user/day) | 11,000 | 0.52 GB | 0.5% ✅ |
| Average (100 calls/user/day) | 22,000 | 1.05 GB | 1.1% ✅ |
| Active (200 calls/user/day) | 44,000 | 2.10 GB | 2.1% ✅ |

### Supabase Egress (limit 5GB/เดือน):
| Users | Egress/เดือน | % | สถานะ |
|-------|------------|---|------|
| 5 users | 0.79 GB | 15.7% | ✅ ปลอดภัย |
| 10 users | 1.57 GB | 31.5% | ⚠️ เริ่มใกล้ |
| 15 users | 2.36 GB | 47.2% | ⚠️ ใกล้ limit |

### Vercel Function Invocations (limit 1M/เดือน):
| Users | Invocations | % |
|-------|------------|---|
| 5 | 41,250 | 4.1% ✅ |
| 10 | 82,500 | 8.3% ✅ |
| 15 | 123,750 | 12.4% ✅ |

### Vercel Active CPU (limit 240 นาที/เดือน):
| Users | CPU นาที | % |
|-------|--------|---|
| 5 | 13.8 | 5.7% ✅ |
| 10 | 27.5 | 11.5% ✅ |
| 15 | 41.3 | 17.2% ✅ |

### Vercel Image Optimization (limit 5,000/เดือน):
- 6,000 รูป × 2 transforms = **12,000 transformations/เดือน**
- **เกิน 7,000 transformations** ❌

---

## 🎯 สรุปความเสี่ยง (10 users ใช้จริง)

| Resource | ใช้จริง | Limit ฟรี | % | สถานะ |
|----------|-------|----------|---|------|
| **DB Storage** | 90 MB | 500 MB | 18% | ✅ ปลอดภัย 5+ ปี |
| **Vercel Bandwidth** | 1.5 GB | 100 GB | 1.5% | ✅ ปลอดภัย |
| **Supabase Egress** | 1.5 GB | 5 GB | 30% | ⚠️ ใกล้ limit |
| **Function Invocations** | 82K | 1M | 8% | ✅ ปลอดภัย |
| **Vercel CPU** | 27 นาที | 240 นาที | 11.5% | ✅ ปลอดภัย |
| **Image Storage** | 13.7 GB/ปี | 1 GB | **1,370%** | ❌ **เกิน 13x!** |
| **Image Optimization** | 12K/เดือน | 5K | **240%** | ❌ เกิน 2.4x |

---

## 🔴 ปัญหาหลัก: รูปภาพ Work Orders

### สถานการณ์:
- ปีแรก: 72,000 รูป × 200KB = **13.7 GB**
- Free tier (Supabase Storage / Vercel Blob): 1 GB เท่านั้น
- **เกิน 13 เท่าในปีแรก!**

### ทางเลือกแก้ปัญหา:

#### ตัวเลือก A: บีบอัดรูปที่ฝั่ง client ก่อนอัปโหลด
- ใช้ `browser-image-compression` library
- ลดขนาดรูปจาก 200KB → 30-50KB (บีบ 75-85%)
- ปีแรก: 72,000 × 50KB = **3.5 GB**
- ยังเกิน free tier 1GB — แต่ลดลงมาก

#### ตัวเลือก B: Cloudflare R2 (10GB free + $0.015/GB)
- ปีแรก: 13.7 GB → ใช้ฟรี 10GB + จ่าย 3.7GB × $0.015 = **$0.06/เดือน**
- ถูกมาก + ไม่มี egress fee
- **แนะนำที่สุด**

#### ตัวเลือก C: Backblaze B2 (10GB free + $0.005/GB)
- ปีแรก: 13.7 GB → ใช้ฟรี 10GB + จ่าย 3.7GB × $0.005 = **$0.02/เดือน**
- ถูกสุด แต่ egress มี fee (1GB ฟรี แล้ว $0.01/GB)

#### ตัวเลือก D: เก็บใน Google Drive (ฟรี 15GB)
- ใช้ Drive API + Service Account
- ฟรี 15GB (พอสำหรับปีแรก)
- ปี 2 ต้องหาทางเลือกใหม่

#### ตัวเลือก E: Upgrade Supabase Pro ($25/เดือน)
- ได้ 8GB storage + 250GB egress
- พอสำหรับ 2-3 ปี

### คำแนะนำ: **B + A** (Cloudflare R2 + บีบอัดที่ client)
- Cloudflare R2 — ถูกที่สุด + ไม่มี egress fee
- บีบอัดรูปที่ client — ลดขนาด 75% ก่อนอัปโหลด
- ต้นทุนจริง: ~$0-5/เดือน (ปีแรก-3)

---

## ⚠️ ความเสี่ยงรอง: Supabase Egress

### ปัจจุบัน (5 users):
- ใช้ ~0.8 GB/เดือน (limit 5GB) — **16% ปลอดภัย**

### อนาคต (10-15 users):
- 10 users: 1.6 GB (32%)
- 15 users: 2.4 GB (47%) — **เริ่มเสี่ยง**

### วิธีลด Egress:
1. **Vercel CDN caching** — cache API responses 5 นาที → ลด DB calls 50-80%
2. **Cache dashboard KPIs** ใน memory (Redis หรือ in-memory)
3. **Paginate + limit** ทุก list endpoint
4. **หลีกเลี่ยง `SELECT *`** — เลือกเฉพาะ fields ที่จำเป็น
5. **ใช้ Supabase read replicas** (Pro plan only)

---

## 📋 Action Plan แก้ไขปัญหา

### 🔴 P0 — ก่อนระบบเสร็จ (1 สัปดาห์)

#### 1. เปลี่ยน image storage → Cloudflare R2
- สมัคร Cloudflare R2 (ฟรี 10GB)
- ติดตั้ง `@cloudflare/r2` หรือใช้ S3-compatible SDK
- อัปเดต `src/lib/storage.ts` เพิ่ม case 'r2'
- Migrate รูปเดิม base64 → R2

#### 2. บีบอัดรูปที่ client
```typescript
import imageCompression from 'browser-image-compression'

const compressed = await imageCompression(file, {
  maxSizeMB: 0.05, // 50KB max
  maxWidthOrHeight: 1280,
  useWebWorker: true,
})
```

#### 3. แก้ parity bugs (Stock API, Meter API, demo banner)
- จากเอกสาร parity — ต้องแก้ก่อนระบบเสร็จ

---

### 🟠 P1 — หลังระบบเสร็จ (1 เดือน)

#### 4. ใช้ Vercel CDN caching
```typescript
// ใน API route ที่ไม่เปลี่ยนบ่อย
export const revalidate = 300 // 5 นาที

// หรือ Cache-Control header
res.headers.set('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
```

#### 5. Cache dashboard KPIs
```typescript
// ใช้ in-memory cache (หรือ Vercel KV free tier)
const cached = cache.get('dashboard-kpis')
if (cached) return cached
// ... compute ...
cache.set('dashboard-kpis', result, 300_000) // 5 min
```

#### 6. เปิด Vercel Analytics + Speed Insights
- ฟรี + วัด performance จริง

---

### 🟡 P2 — ระยะยาว (3-6 เดือน)

#### 7. ตั้ง RLS policies บน 30 tables
#### 8. ใช้ Supabase Realtime แทน polling
#### 9. ลบ unused indexes (20 ตัว)

---

## 💰 ต้นทุนจริงหลังแก้ปัญหา

| Service | ต้นทุน/เดือน | หมายเหตุ |
|---------|------------|---------|
| Vercel Hobby | $0 | ใช้ทุกอย่างใน free tier |
| Supabase Free | $0 | DB + egress ใน free tier |
| Cloudflare R2 | $0-0.06 | ฟรี 10GB + $0.015/GB เกิน |
| บีบอัดรูป | $0 | ทำที่ client ไม่มีค่าใช้จ่าย |
| **รวมปีแรก** | **$0-1/เดือน** | ถูกมาก |

| ปีที่ | R2 storage | ค่าใช้จ่าย R2 | รวม/ปี |
|------|-----------|------------|--------|
| ปี 1 | 3.5 GB (หลังบีบ) | $0 | $0 |
| ปี 2 | 7 GB | $0 | $0 |
| ปี 3 | 10.5 GB | $0.08 | $1/ปี |

> ✅ **ใช้ฟรีได้ 3+ ปี** — ถ้าทำตามแผน P0+P1

---

## 📊 สรุป

### ปัญหาเดียวที่ต้องแก้ด่วน: **รูปภาพ Work Orders**

- ใช้จริง: 72,000 รูป/ปี = 13.7 GB
- Free tier ทุกตัว: 1 GB = เกิน 13x
- **แก้ด้วย: Cloudflare R2 (ฟรี 10GB) + บีบอัดรูปที่ client**
- ต้นทุนหลังแก้: **$0/เดือน**

### ส่วนอื่นๆ ปลอดภัย:
- ✅ DB Storage — ปลอดภัย 5+ ปี
- ✅ Bandwidth — ปลอดภัยมาก
- ✅ Function Invocations — ปลอดภัยมาก
- ✅ CPU — ปลอดภัยมาก
- ⚠️ Supabase Egress — ปลอดภัย 10 users, ระวังถ้า 15+ users

### คำแนะนำสุดท้าย:
1. **P0 ด่วน:** เปลี่ยนรูปไป Cloudflare R2 + บีบอัดที่ client
2. **P1:** เปิด Vercel CDN caching + Analytics
3. **P2:** ตั้ง RLS policies + Realtime

> ถ้าทำตามนี้ — ใช้ฟรีได้อีก 3+ ปีโดยไม่ต้อง upgrade อะไรเลย

---

*Prepared by QA Team — 2026-08-29*
*ข้อมูลจริงจาก User + คำนวณจาก free tier limits ล่าสุด*
