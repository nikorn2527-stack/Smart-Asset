'use client'

/**
 * OrganizationsList — แสดงรายการองค์กรทั้งหมด
 * ใช้ใน Settings → Organizations tab
 */
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Building2, CheckCircle2, Globe, Clock, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { bearerHeaders } from '@/lib/http-headers'

export function OrganizationsList() {
  const token = useAuthStore((s) => s.token)

  const { data, isLoading } = useQuery({
    queryKey: ['organizations-list'],
    queryFn: async () => {
      const res = await fetch('/api/organizations', {
        headers: bearerHeaders(token),
      })
      if (!res.ok) throw new Error('Failed to load organizations')
      return res.json()
    },
  })

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
  }

  const orgs = data?.organizations || []

  if (orgs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
        <Building2 className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-2 text-sm">ยังไม่มีองค์กร</p>
        <p className="text-xs text-muted-foreground">ไปที่ Setup Wizard เพื่อสร้างองค์กรใหม่</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orgs.map((org: any) => (
        <Card key={org.id} className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-[#f97316]" />
                  <h3 className="text-base font-semibold">{org.name}</h3>
                  {org.active ? (
                    <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
                      <CheckCircle2 className="mr-0.5 h-3 w-3" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-slate-400">Inactive</Badge>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-slate-600 dark:text-slate-400">{org.code}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {org.timezone}
                  </div>
                  <div className="flex items-center gap-1">
                    <Coins className="h-3 w-3" />
                    {org.currency}
                  </div>
                  {org.type && (
                    <div className="flex items-center gap-1">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">{org.type}</span>
                    </div>
                  )}
                </div>
                {org.email || org.phone || org.address ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {org.email && <span className="mr-3">{org.email}</span>}
                    {org.phone && <span className="mr-3">{org.phone}</span>}
                    {org.address}
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
