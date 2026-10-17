'use client'

/**
 * StockTabs — Main tab container for the Stock Management UI.
 *
 * 8 tabs (matching the original Apps Script layout):
 *   1. ภาพรวม          (Dashboard)
 *   2. คลังสินค้า      (Inventory)
 *   3. รับเข้า          (Stock-In)
 *   4. เบิกออก          (Stock-Out)
 *   5. รออนุมัติ        (Pending Approval)
 *   6. ใบสั่งซื้อ       (Purchase Orders)
 *   7. ประวัติ          (History)
 *   8. สรุป             (Summary)
 *
 * Color scheme: orange (#f97316) primary, teal (#0d9488) accents.
 */

import * as React from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Package,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  FileText,
  History,
  BarChart3,
  LayoutDashboard,
} from 'lucide-react'
import { StockDashboard } from './stock-dashboard'
import { StockInventory } from './stock-inventory'
import { StockInForm } from './stock-in-form'
import { StockOutForm } from './stock-out-form'
import { StockPending } from './stock-pending'
import { StockPurchaseOrders } from './stock-purchase-orders'
import { StockHistory } from './stock-history'
import { StockSummary } from './stock-summary'

export function StockTabs() {
  const [tab, setTab] = React.useState('dashboard')

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      {/* Page header — FIXED */}
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          📦 คลังสต็อก
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          จัดการอุปกรณ์สิ้นเปลือง อะไหล่ และวัสดุ — ครอบคลุมรับเข้า เบิกออก
          อนุมัติ ใบสั่งซื้อ ประวัติ และสรุป
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="flex h-auto w-full flex-shrink-0 flex-wrap justify-start gap-1 p-1 dark:bg-slate-900 dark:border dark:border-slate-800">
          <TabsTrigger value="dashboard" className="gap-1.5" onClick={() => setTab("dashboard")}>
            <LayoutDashboard className="h-3.5 w-3.5" /> ภาพรวม
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5" onClick={() => setTab("pending")}>
            <Clock className="h-3.5 w-3.5" /> รออนุมัติ
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-1.5" onClick={() => setTab("inventory")}>
            <Package className="h-3.5 w-3.5" /> คลังสินค้า
          </TabsTrigger>
          <TabsTrigger value="in" className="gap-1.5" onClick={() => setTab("in")}>
            <ArrowDownCircle className="h-3.5 w-3.5" /> รับเข้า
          </TabsTrigger>
          <TabsTrigger value="out" className="gap-1.5" onClick={() => setTab("out")}>
            <ArrowUpCircle className="h-3.5 w-3.5" /> เบิกออก
          </TabsTrigger>
          <TabsTrigger value="po" className="gap-1.5" onClick={() => setTab("po")}>
            <FileText className="h-3.5 w-3.5" /> ใบสั่งซื้อ
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5" onClick={() => setTab("history")}>
            <History className="h-3.5 w-3.5" /> ประวัติ
          </TabsTrigger>
          <TabsTrigger value="summary" className="gap-1.5" onClick={() => setTab("summary")}>
            <BarChart3 className="h-3.5 w-3.5" /> สรุป
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-0 min-h-0 flex-1 overflow-auto">
          <StockDashboard />
        </TabsContent>
        <TabsContent value="inventory" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <StockInventory />
        </TabsContent>
        <TabsContent value="in" className="mt-0 min-h-0 flex-1 overflow-auto">
          <StockInForm />
        </TabsContent>
        <TabsContent value="out" className="mt-0 min-h-0 flex-1 overflow-auto">
          <StockOutForm />
        </TabsContent>
        <TabsContent value="pending" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <StockPending />
        </TabsContent>
        <TabsContent value="po" className="mt-0 min-h-0 flex-1 overflow-auto">
          <StockPurchaseOrders />
        </TabsContent>
        <TabsContent value="history" className="mt-0 min-h-0 flex-1 overflow-hidden">
          <StockHistory />
        </TabsContent>
        <TabsContent value="summary" className="mt-0 min-h-0 flex-1 overflow-auto">
          <StockSummary />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default StockTabs
