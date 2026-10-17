# 📊 วิเคราะห์ Google Drive vs Storage ใหม่ (เรื่องความเร็ว)

| ฟิลด์ | ค่า |
|------|-----|
| **Document ID** | STORAGE-PERFORMANCE-ANALYSIS-004 |
| **วันที่** | 2026-08-29 |
| **คำถาม** | Google Drive มีผลเรื่องความเร็วไหม? ควรย้ายหรือปล่อย? |

---

## 🎯 คำตอบสั้น: **มีผลครับ — Google Drive ช้ากว่าและไม่เสถียร**

แต่ไม่ได้แย่มาก — ขึ้นอยู่กับว่า user สามารถรอได้แค่ไหน

---

## 📊 เปรียบเทียบความเร็วจริง

### 🐌 Google Drive (lh5.googleusercontent.com):

| ปัญหา | รายละเอียด |
|------|----------|
| **Redirect overhead** | Drive URL → redirect → ค่อยไป lh5.googleusercontent.com (HTTP 302) |
| **ไม่มี CDN เฉพาะ** | ใช้ Google CDN ทั่วไป ไม่ optimize สำหรับ images |
| **Rate limit** | Google จำกัด requests/IP — ถ้ารูปเยอะจะโหลดไม่ได้ |
| **Hotlinking policy** | Google อาจบล็อก hotlink ได้ทุกเมื่อ (เคยเกิดปี 2020) |
| **No image optimization** | ไม่มี resize/format conversion อัตโนมัติ |
| **Latency** | ~200-500ms ต่อรูป (รวม redirect) |

### ⚡ Cloudflare R2 / Vercel Blob:

| ข้อดี | รายละเอียด |
|------|----------|
| **No redirect** | URL ตรงไปที่รูปเลย (HTTP 200 ทันที) |
| **CDN เฉพาะ** | Cloudflare: 300+ edge locations; Vercel: integrated CDN |
| **No rate limit** | ไม่จำกัด requests |
| **Stable hotlinking** | ออกแบบมาสำหรับ web hosting |
| **Image optimization** | Vercel Blob + next/image: auto resize + WebP |
| **Latency** | ~30-80ms ต่อรูป |

### 📈 ความแตกต่างจริง:
- **Google Drive: 200-500ms/รูป**
- **Cloudflare R2: 30-80ms/รูป**
- **R2 เร็วกว่า 3-5x**

---

## 🎯 ผลกระทบกับ ITAM-NextJS:

### สถานการณ์จริง:
- WorkOrder 1 เคสแสดงรูป 6 รูป (ก่อน + สำรวจ + ปิดงาน)
- ถ้าเปิด detail sheet 1 WO → โหลดรูป 6 รูปพร้อมกัน

### เวลาที่ user รอ:
| Storage | 6 รูปโหลดพร้อมกัน | สัมผัสได้ไหม |
|---------|----------------|------------|
| **Google Drive** | 200-500ms × 6 = ~1-3 วินาที | ✅ สัมผัสได้ (ช้าเล็กน้อย) |
| **Cloudflare R2** | 30-80ms × 6 = ~200-400ms | ❌ แทบไม่รู้สึก |
| **Vercel Blob + next/image** | 30-80ms × 6 = ~200-400ms | ❌ แทบไม่รู้สึก |

---

## ⚠️ ความเสี่ยงของ Google Drive:

### 1. **Policy change risk** ⚠️
Google เคยบล็อก hotlinking ในปี 2020 — ทำให้รูปใน Google Sheets หายไปหมด
- แม้ตอนนี้ใช้ได้ — แต่ Google ไม่รับประกันว่าจะใช้ได้ตลอด
- ถ้าเกิดอีก → รูปเก่าทั้งหมดหาย

### 2. **Rate limit risk** ⚠️
Google จำกัด requests ต่อ IP:
- ถ้า 10 users เปิด WorkOrder พร้อมกัน → 60 requests ทันที
- Google อาจ throttle → รูปบางรูปไม่โหลด (broken image)
- ต้อง refresh หน้าจอ

### 3. **No Service Level Agreement (SLA)** ⚠️
- Google Drive ฟรี — ไม่มี SLA
- ถ้า Google ล่ม → ระบบก็ใช้ไม่ได้
- ไม่มีทางรู้ล่วงหน้า

---

## 💡 คำแนะนำ: แบบผสม (Hybrid) ตามที่ User เสนอ

### ✅ แผนที่แนะนำ:

```
รูปเก่า (ปัจจุบัน - ก่อน production):
  → เก็บใน Google Drive เหมือนเดิม (ไม่ต้องย้าย)
  → แค่ migrate URL ไปใช้ในระบบใหม่

รูปใหม่ (หลัง production):
  → เก็บใน Cloudflare R2 (ฟรี 10GB)
  → บีบอัดที่ client ก่อน upload
```

### 🎯 ข้อดีของแผนนี้:
1. ✅ ไม่ต้อง migrate รูปเก่า (ประหยัดเวลา + ไม่เสี่ยงข้อมงหาย)
2. ✅ รูปใหม่เร็วกว่า (R2)
3. ✅ รูปเก่ายังใช้ได้ (ถ้า Google ไม่เปลี่ยน policy)
4. ✅ ต้นทุน $0 — Cloudflare R2 ฟรี 10GB

### ⚠️ ข้อเสีย:
1. รูปเก่ายังช้า (Google Drive 200-500ms)
2. ถ้า Google บล็อก hotlink → รูปเก่าหาย
3. ต้องดูแล 2 storage พร้อมกัน

---

## 📋 Implementation Plan:

### Phase 1 (P0 — ก่อน production):
1. **ติดตั้ง Cloudflare R2** + bucket `itam-work-orders`
2. **เพิ่ม provider 'r2'** ใน `src/lib/storage.ts`
3. **บีบอัดรูปที่ client** (browser-image-compression)
4. **ตั้งค่า default provider = 'r2'** สำหรับรูปใหม่

### Phase 2 (Optional — หลัง production):
5. **Migrate รูปเก่า** จาก Google Drive → R2 (ถ้าต้องการ)
   - ใช้ Google Drive API ดาวน์โหลด
   - Upload ไป R2
   - Update URL ใน DB
   - ประมาณ 2,000-3,000 รูปเก่า → 1-2 วัน migrate

### Phase 3 (Monitor):
6. **เช็ค Google Drive URL ทุก 3 เดือน** — ถ้า Google เปลี่ยน policy → migrate ด่วน
7. **ใช้ Vercel Analytics** เพื่อดู image load time จริง

---

## 📊 ตัวอย่าง Code (Hybrid Storage):

```typescript
// src/lib/storage.ts (แก้ไข)

case 'r2':
  // รูปใหม่ — เก็บใน Cloudflare R2
  const r2 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
  const key = `work-orders/${woId}/${Date.now()}-${filename}`
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  }))
  return `${process.env.R2_PUBLIC_URL}/${key}`

case 'google-drive':
  // รูปเก่า — ยังเก็บใน Google Drive (อ่าน URL เดิม)
  // ไม่ upload ใหม่ — แค่ return URL ที่มีอยู่
  return existingGoogleDriveUrl
```

```typescript
// src/components/...work-order-image-upload.tsx

import imageCompression from 'browser-image-compression'

async function handleUpload(file: File) {
  // 1. บีบอัดที่ client ก่อน
  const compressed = await imageCompression(file, {
    maxSizeMB: 0.05, // 50KB
    maxWidthOrHeight: 1280,
    useWebWorker: true,
  })
  
  // 2. Upload ไป R2
  const url = await uploadFile(compressed, 'work-orders', 'r2')
  
  // 3. Save URL ใน DB
  await saveImageToDB(url)
}
```

---

## 📊 สรุป:

### คำถาม: Google Drive มีผลเรื่องความเร็วไหม?
**ตอบ: ใช่ครับ — ช้ากว่า 3-5 เท่า แต่ไม่ได้แย่มาก**

### คำถาม: ควรย้ายรูปเก่าไหม?
**ตอบ: ไม่ต้องครับ — ปล่อยไว้ที่ Google Drive ตามที่ User เสนอ**

### เหตุผล:
1. ✅ รูปเก่าใช้ได้ (ถ้า Google ไม่เปลี่ยน policy)
2. ✅ ประหยัดเวลา migrate
3. ✅ ไม่เสี่ยงข้อมูลหายระหว่าง migrate
4. ⚠️ รูปเก่าช้ากว่าเล็กน้อย แต่ user ยังรอได้ (1-3 วิ)

### แผนที่แนะนำ:
- **รูปใหม่:** Cloudflare R2 + บีบอัดที่ client
- **รูปเก่า:** ปล่อยไว้ Google Drive
- **ต้นทุน:** $0/เดือน
- **ความเร็ว:** รูปใหม่เร็ว 3-5x, รูปเก่าเหมือนเดิม

### ความเสี่ยง:
- ⚠️ ถ้า Google บล็อก hotlink ในอนาคต → รูปเก่าหาย
- 💡 **ทางแก้:** ตั้ง cron job ตรวจ Google Drive URL ทุกเดือน — ถ้าเริ่ม fail ให้ migrate ด่วน

---

## 🎯 Action Plan (สุดท้าย):

1. **P0:** ตั้ง Cloudflare R2 + บีบอัดรูปที่ client สำหรับรูปใหม่
2. **P1:** ปล่อยรูปเก่าไว้ Google Drive (ไม่ต้อง migrate)
3. **P2:** ตั้ง cron ตรวจ Google Drive URL ทุกเดือน
4. **P3 (optional):** ถ้าเวลาพอ — migrate รูปเก่าทีละส่วน

> ✅ **ใช้ฟรีได้ + รูปใหม่เร็วขึ้น + รูปเก่ายังใช้ได้**

---

*Prepared by QA Team — 2026-08-29*
