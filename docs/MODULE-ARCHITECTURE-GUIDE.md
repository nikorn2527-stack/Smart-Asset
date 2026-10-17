# Module Architecture Migration Guide

> แผนย้าย ITAM Next.js จากโครงสร้างตาม technical layer (`components`, `lib`,
> `app/api`) ไปสู่โครงสร้าง **domain module** แบบค่อยเป็นค่อยไป โดยไม่หยุดการ
> ส่งมอบฟีเจอร์ และยังคง API ปัจจุบันไว้ตลอดช่วง migration

- **Starting commit:** `95679b5` (`Fix mobile mode navigation route`)
- **ระยะเวลาเป้าหมาย:** 4–6 สัปดาห์
- **เป้าหมายคุณภาพ:** ผ่าน checklist ด้าน modularity อย่างน้อย 95%
- **ขอบเขต:** จัดระเบียบ dependency และ ownership; ไม่เปลี่ยน business rule,
  schema หรือ public API โดยไม่มี ADR/issue แยก

---

## 1. สถานะปัจจุบัน

### Codebase baseline

| ตัวชี้วัด | ค่า ณ จุดเริ่มต้น | ความหมาย |
|---|---:|---|
| ไฟล์ TypeScript/TSX ใน `src` | 421 | โค้ดที่ต้องทยอยย้าย ไม่ควรย้ายเป็น big-bang |
| ITAM UI components | 97 | มีทั้งหน้าใหม่และ legacy aliases อยู่ร่วมกัน |
| API route handlers | 184 | route เป็นจุดที่มี direct database access มากที่สุด |
| direct imports ของ `@/lib/db` | มีในหลาย route | เป็น baseline สำหรับ Phase 2 |
| active branch | `work` | เริ่มจาก commit ที่ระบุด้านบน |

### สิ่งที่มีอยู่แล้วและควรรักษาไว้

1. **Next App Router** เป็น delivery edge: `src/app/api/**/route.ts` รับ/ตอบ HTTP
   ได้ แต่ไม่ควรเป็นที่อยู่ของ domain logic ระยะยาว
2. **Prisma client** อยู่ที่ `src/lib/db.ts`; Phase 2 จะย้าย ownership ของ query
   เข้า repository โดยไม่สร้าง Prisma client ใหม่ต่อ module
3. **authorization context** และ RBAC เป็น shared security boundary จึงต้องเป็น
   dependency ของ module ไม่ใช่สิ่งที่ module ใด module หนึ่งเป็นเจ้าของ
4. **pre-commit hook** ที่ `.githooks/pre-commit` ตรวจ Prisma-field naming และ
   TypeScript syntax อยู่แล้ว; จะต่อยอดด้วย ESLint boundary checks ใน Phase 4
5. **compatibility is mandatory:** route URL, response shape, auth behavior และ
   navigation page id ที่มีอยู่ต้องไม่เปลี่ยนโดยไม่มี contract test

### Baseline commands

```bash
bun install
git config core.hooksPath .githooks
bun run db:push
node scripts/create-demo-users.js
bun scripts/seed-authorization-catalog.ts
bun run dev
```

> ใช้ `git status --short --branch`, `git rev-parse --short HEAD` และ
> `find src -type f \( -name '*.ts' -o -name '*.tsx' \)` เพื่อบันทึก baseline
> ก่อนเริ่มแต่ละ phase. อย่า commit `.env`, SQLite database หรือ build artifact.

---

## 2. Module Dependency Graph

### 4 layers

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Delivery: src/app, API route adapters, page composition, sidebar      │
│             ↓ imports only each module's public barrel                │
├──────────────────────────────────────────────────────────────────────┤
│ Feature UI: module/ui, hooks, view models                             │
│             ↓ calls module services; never imports repository/db      │
├──────────────────────────────────────────────────────────────────────┤
│ Domain: module/services, contracts, policies                           │
│             ↓ calls module repositories and other module services     │
├──────────────────────────────────────────────────────────────────────┤
│ Data: module/repositories + shared infrastructure (db/auth/audit)     │
│             ↓ only repositories import @/lib/db                       │
└──────────────────────────────────────────────────────────────────────┘
```

Allowed direction is **downward only**. A lower layer never imports a UI,
route, or sibling module implementation. Cross-module calls go through a
barrel-exported service interface.

### 16 domain modules

| Module | Owns | Depends on | Can disable? |
|---|---|---|---|
| `auth` | sessions, identity, login | authorization, audit | No |
| `authorization` | roles, grants, site scope | auth, audit | No |
| `devices` | assets, lifecycle, assignment | authorization, audit | No |
| `meters` | readings, cycles, snapshots | devices, authorization | Yes |
| `work-orders` | repair requests and workflow | devices, stock, authorization | Yes |
| `stock` | inventory and transactions | work-orders, authorization | Yes |
| `dashboard` | operational read models | devices, meters, stock, work-orders | Yes |
| `reports` | unified/monthly report read models | all operational modules | Yes |
| `paper-analytics` | page usage analytics | meters, devices | Yes |
| `import` | CSV/Excel parsing and import jobs | devices, stock, audit | Yes |
| `templates` | document/sticker templates | authorization | Yes |
| `stickers` | rendering/printing labels | devices, templates | Yes |
| `settings` | org profile and master settings | authorization, audit | Yes |
| `notifications` | notification preferences/delivery | auth, work-orders | Yes |
| `audit` | audit writes and audit read model | authorization | No |
| `sync` | legacy bridge and sync runs | devices, stock, work-orders, audit | Yes |

**Can disable** means the module can be hidden from navigation and reject its
route adapter with `404 MODULE_DISABLED`; it does *not* mean deleting database
tables or bypassing authorization. `auth`, `authorization`, and `audit` are
platform modules and must remain enabled.

---

## 3. Target folder structure

```text
src/
  app/
    api/                         # Thin HTTP adapters only
      devices/route.ts            # imports { devicesService } from @/modules/devices
    page.tsx                      # app shell and page composition
  config/
    modules.ts                    # module manifest and dependency resolver
  modules/
    devices/
      index.ts                    # the only supported public import path
      contracts.ts                # DTOs, ports, errors, public types
      service.ts                  # use cases / business rules
      repository.ts               # Prisma implementation (internal)
      policy.ts                   # domain-specific authorization policy
      ui/
        devices-page.tsx
        device-detail-sheet.tsx
      __tests__/
        service.test.ts
        repository.integration.test.ts
    work-orders/
      index.ts
      contracts.ts
      service.ts
      repository.ts
      ui/
    ...                           # remaining modules from the table above
  shared/
    auth/                         # framework-neutral auth helpers
    database/                     # shared Prisma client adapter only
    errors/
    observability/
  lib/                            # temporary compatibility shims during migration
```

### Folder rules

- `src/modules/<name>/index.ts` is the module boundary. Code outside the
  module may not import `service.ts`, `repository.ts`, or `ui/*` directly.
- A module owns its DTOs in `contracts.ts`. Do not export Prisma model types
  across a module boundary.
- `repository.ts` is internal. It may import `@/lib/db` during migration; no
  `route.ts`, `ui`, or `service.ts` may do so.
- Existing files are moved only after their compatibility route/page is backed
  by tests. A re-export shim in `src/lib` is allowed temporarily and must have
  a removal issue.

---

## 4. Module Interface (Contract)

### Barrel export

```ts
// src/modules/devices/index.ts
export { devicesService } from './service'
export type {
  CreateDeviceInput,
  DeviceDto,
  DeviceRepository,
  DeviceSearch,
} from './contracts'
```

A route consumes the public boundary, not the implementation:

```ts
// src/app/api/devices/route.ts
import { devicesService } from '@/modules/devices'

export async function POST(request: Request) {
  const input = await request.json()
  const device = await devicesService.create(input)
  return Response.json(device, { status: 201 })
}
```

### Service pattern

```ts
// src/modules/devices/service.ts
import type { CreateDeviceInput, DeviceDto, DeviceRepository } from './contracts'

export function createDevicesService(repository: DeviceRepository) {
  return {
    async create(input: CreateDeviceInput): Promise<DeviceDto> {
      // validate input, authorise actor, enforce lifecycle rules, audit action
      return repository.create(input)
    },
  }
}

export const devicesService = createDevicesService(devicesRepository)
```

Services own use cases, validation orchestration, policies, transactions, audit
writes, and calls to other module **services**. They do not accept `Request`,
return `NextResponse`, render JSX, or expose Prisma query objects.

### Repository pattern

```ts
// src/modules/devices/repository.ts
import { db } from '@/lib/db'
import type { CreateDeviceInput, DeviceDto, DeviceRepository } from './contracts'

export const devicesRepository: DeviceRepository = {
  async create(input: CreateDeviceInput): Promise<DeviceDto> {
    const row = await db.device.create({ data: mapCreateInput(input) })
    return mapDevice(row)
  },
}
```

Repositories own persistence queries and mapping between database rows and DTOs.
They do not make authorization decisions, emit HTTP responses, or call sibling
repositories.

---

## 5. Cross-Module Rules

1. **Service-only writes.** A module may initiate another module's command
   only through its exported service; never import a sibling repository.
2. **Interface-only dependency.** A module imports sibling public types from
   the barrel. It must not use a sibling's Prisma models or internal paths.
3. **Aggregation-read rule.** Dashboard and reports may compose read-only DTOs
   from exported query/service methods. They must not perform operational
   writes, and they cannot become a backdoor around site-scope authorization.
4. **UI stays in the owning module.** Domain UI belongs in `<module>/ui`.
   `src/app/page.tsx` composes pages and navigation only; shared UI belongs in
   `src/components/ui`, not another domain module.

Exceptions require an ADR containing the dependency direction, security
impact, rollback plan, owner, and expiry date.

---

## 6. Module Manifest

Create `src/config/modules.ts` in Phase 1. It is the single source of truth
for module feature availability and dependency validation.

```ts
export type ModuleName =
  | 'auth' | 'authorization' | 'devices' | 'meters' | 'work-orders'
  | 'stock' | 'dashboard' | 'reports' | 'paper-analytics' | 'import'
  | 'templates' | 'stickers' | 'settings' | 'notifications' | 'audit' | 'sync'

export interface ModuleDefinition {
  enabled: boolean
  dependencies: readonly ModuleName[]
  required: boolean
}

export const modules: Record<ModuleName, ModuleDefinition> = {
  auth: { enabled: true, required: true, dependencies: [] },
  authorization: { enabled: true, required: true, dependencies: ['auth', 'audit'] },
  devices: { enabled: true, required: true, dependencies: ['authorization', 'audit'] },
  meters: { enabled: true, required: false, dependencies: ['devices', 'authorization'] },
  'work-orders': { enabled: true, required: false, dependencies: ['devices', 'stock', 'authorization'] },
  stock: { enabled: true, required: false, dependencies: ['authorization'] },
  dashboard: { enabled: true, required: false, dependencies: ['devices', 'meters', 'stock', 'work-orders'] },
  reports: { enabled: true, required: false, dependencies: ['devices', 'meters', 'stock', 'work-orders'] },
  'paper-analytics': { enabled: true, required: false, dependencies: ['meters', 'devices'] },
  import: { enabled: true, required: false, dependencies: ['devices', 'stock', 'audit'] },
  templates: { enabled: true, required: false, dependencies: ['authorization'] },
  stickers: { enabled: true, required: false, dependencies: ['devices', 'templates'] },
  settings: { enabled: true, required: false, dependencies: ['authorization', 'audit'] },
  notifications: { enabled: true, required: false, dependencies: ['auth', 'work-orders'] },
  audit: { enabled: true, required: true, dependencies: [] },
  sync: { enabled: true, required: false, dependencies: ['devices', 'stock', 'work-orders', 'audit'] },
}
```

At startup/CI, validate that (a) required modules are enabled, (b) every enabled
module has all dependencies enabled, and (c) the graph is acyclic. Sidebar
items and route adapters must consult this resolver; hiding an item alone is
not a security control.

---

## 7. Migration Plan

| Phase | Duration | Work | Exit criteria |
|---|---|---|---|
| 1 — skeleton | Week 1 | Add manifest, folders, barrels, resolver, sidebar wiring; migrate one small vertical slice | All 16 definitions valid; disabled feature is hidden and route-protected |
| 2 — repositories | Week 2 | Move direct Prisma access behind repositories, module by module | `rg "from '@/lib/db'" src/app src/modules/*/{service,ui}*` returns no violations |
| 3 — services | Week 3 | Move business rules into services; replace sibling data access | Cross-module commands go through exported service contracts |
| 4 — UI/boundaries | Weeks 4–6 | Co-locate UI, remove legacy shims, enforce ESLint rules, run isolation tests | 95%+ success checklist and no unapproved exceptions |

### Phase sequence and rollback

1. Start with a low-risk vertical slice (`templates` or `settings`) to validate
   the pattern before moving `devices`, `stock`, and `work-orders`.
2. Preserve every existing route as an adapter. Its test remains the contract.
3. Use one PR per module/slice; no “move all files” PRs.
4. Keep the previous implementation behind a short-lived internal adapter when
   rollback is needed. Remove it only after production verification.
5. Treat `devices → meters → stock/work-orders → reports/dashboard` as the
   high-risk ordering because downstream read models depend on these modules.

---

## 8. Testing Strategy

| Level | Scope | Required evidence |
|---|---|---|
| Unit | service policy, validation, DTO mapping | fast `vitest` tests with fake repository ports |
| Repository integration | Prisma query/mapping and transactions | isolated SQLite/test DB, fixture cleanup |
| Route contract | status, response shape, auth and site scope | existing API integration tests retained |
| Cross-module integration | service-to-service workflows | device transfer/meter/stock/WO scenarios |
| Isolation | disabled module and import boundaries | graph validation + ESLint + route `404 MODULE_DISABLED` |
| UI | module UI behavior and a11y | Playwright happy/error/permission scenarios |

Minimum tests for each migrated module:

```text
[ ] service unit test: success + validation error + authorization denial
[ ] repository integration test: persistence + mapper + transaction rollback
[ ] route contract test: existing URL/JSON/status unchanged
[ ] dependency test: module can load with a fake repository port
[ ] feature-toggle test: disabled module is unavailable in sidebar and route
```

---

## 9. Success Metrics (95%+)

Score this checklist on every migration milestone. The release gate is **at
least 95 of 100 weighted points**, with no critical security item failing.

| Category | Weight | Passing condition |
|---|---:|---|
| Structural | 25 | every migrated module has barrel/contracts/service/repository ownership |
| Behavioral | 25 | route/auth/site-scope regression suite passes unchanged |
| Functional | 20 | migrated UI and API flows pass success/error states |
| Quality | 20 | boundary ESLint, typecheck, lint and tests pass |
| Operations | 10 | manifest validation, disable behavior, logs and rollback documented |

Critical non-negotiables: zero direct database imports outside repositories,
zero sibling internal imports, no route bypass for disabled modules, and no
site-scope authorization regression.

---

## 10. Risks and Mitigation

| Risk | Why it matters | Mitigation |
|---|---|---|
| Big-bang refactor | breaks 184 route contracts at once | vertical slices, compatibility adapters, one-module PRs |
| Circular dependency | makes modules impossible to isolate | manifest cycle check; depend on contracts/services only |
| Authorization regression | cross-site access is high impact | preserve authorization context; add denial tests to every service |
| Duplicate legacy/new paths | inconsistent behavior and data | make adapters delegate to one service; add removal date/owner |

Escalate immediately if a module move changes a schema migration, public
response, RBAC decision, or transaction boundary. Those changes require a
separate reviewed PR and explicit test evidence.

---

## 11. Handover Checklist

### Setup

```bash
git checkout 95679b5
bun install
git config core.hooksPath .githooks
bun run db:push
node scripts/create-demo-users.js
bun scripts/seed-authorization-catalog.ts
bun run dev
```

### Before starting a module

```text
[ ] Record current commit and clean git status
[ ] Identify existing routes, UI entry points, contracts, and tests
[ ] Declare the module and dependencies in src/config/modules.ts
[ ] Add/confirm barrel exports and repository port
[ ] Add service and route contract tests before moving implementation
[ ] Verify sidebar and route behavior when enabled and disabled
```

### Before merge

```text
[ ] No direct db import outside repository/shared database adapter
[ ] No cross-module internal import
[ ] Existing API response and authorization behavior remains compatible
[ ] Unit, integration, isolation, lint, and typecheck evidence attached
[ ] Legacy shim has owner and removal milestone, or was removed
[ ] Migration score is >=95% and all critical items pass
```

## Decision

**ทำได้ และควรทำแบบ gradual migration ตามแผนนี้**. การเริ่มจาก module skeleton
และ manifest ก่อน จะทำให้ทีมวัด boundary ได้ตั้งแต่สัปดาห์แรก โดยไม่ต้องหยุด
feature delivery; จากนั้น repository, service และ UI สามารถย้ายทีละ vertical slice
จนได้ความเป็น modular ที่ตรวจสอบได้จริง แทนการประเมินจาก folder name เพียงอย่างเดียว.
