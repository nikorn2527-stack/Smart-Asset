'use client'

/**
 * ReportCharts — ชุดกราฟสำหรับรายงาน
 *
 * ใช้ recharts (ติดตั้งแล้ว) สำหรับ:
 *   - Bar chart: เปรียบเทียบจำนวนตามหมวดหมู่
 *   - Pie chart: สัดส่วนตามสถานะ
 *   - Line chart: แนวโน้มรายเดือน
 *   - Area chart: สะสม
 *
 * Data source: GET /api/reports/unified?group=<group>&month=<YYYY-MM>
 *
 * Colors: ใช้ orange/teal palette (ไม่ใช้ indigo/blue)
 */

import * as React from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, AreaChart, Area, Legend,
} from 'recharts'
import { VisibleResponsiveContainer } from '@/components/itam/visible-responsive-container'
import { useTheme } from 'next-themes'

// Color palette — orange/teal/amber/emerald (no indigo/blue)
export const CHART_COLORS = [
  '#f97316', // orange-500
  '#0d9488', // teal-600
  '#eab308', // yellow-500
  '#10b981', // emerald-500
  '#f43f5e', // rose-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#84cc16', // lime-500
  '#ec4899', // pink-500
  '#f59e0b', // amber-500
]

interface ChartData {
  name: string
  value: number
  [key: string]: string | number
}

/** Bar chart — เปรียบเทียบจำนวนตามหมวดหมู่ */
export function ReportBarChart({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 250,
  color,
}: {
  data: ChartData[]
  dataKey?: string
  nameKey?: string
  height?: number
  color?: string
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const textColor = isDark ? '#94a3b8' : '#64748b'
  const gridColor = isDark ? '#1e293b' : '#f1f5f9'

  return (
    <VisibleResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey={nameKey}
          tick={{ fontSize: 11, fill: textColor }}
          tickLine={false}
          axisLine={{ stroke: gridColor }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: textColor }}
          tickLine={false}
          axisLine={{ stroke: gridColor }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: `1px solid ${gridColor}`,
            borderRadius: '8px',
            fontSize: '12px',
          }}
          labelStyle={{ color: textColor, fontWeight: 600 }}
        />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} fill={color || CHART_COLORS[0]} />
      </BarChart>
    </VisibleResponsiveContainer>
  )
}

/** Pie chart — สัดส่วน */
export function ReportPieChart({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 250,
}: {
  data: ChartData[]
  dataKey?: string
  nameKey?: string
  height?: number
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <VisibleResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={dataKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={height * 0.35}
          innerRadius={height * 0.2}
          paddingAngle={2}
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
          style={{ fontSize: '11px' }}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
      </PieChart>
    </VisibleResponsiveContainer>
  )
}

/** Line chart — แนวโน้มรายเดือน */
export function ReportLineChart({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 250,
  color,
}: {
  data: ChartData[]
  dataKey?: string
  nameKey?: string
  height?: number
  color?: string
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const textColor = isDark ? '#94a3b8' : '#64748b'
  const gridColor = isDark ? '#1e293b' : '#f1f5f9'

  return (
    <VisibleResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: textColor }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: textColor }} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: `1px solid ${gridColor}`,
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color || CHART_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 3, fill: color || CHART_COLORS[0] }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </VisibleResponsiveContainer>
  )
}

/** Area chart — สะสม */
export function ReportAreaChart({
  data,
  dataKey = 'value',
  nameKey = 'name',
  height = 250,
  color,
}: {
  data: ChartData[]
  dataKey?: string
  nameKey?: string
  height?: number
  color?: string
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const textColor = isDark ? '#94a3b8' : '#64748b'
  const gridColor = isDark ? '#1e293b' : '#f1f5f9'
  const chartColor = color || CHART_COLORS[0]

  return (
    <VisibleResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="colorArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey={nameKey} tick={{ fontSize: 11, fill: textColor }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: textColor }} tickLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            border: `1px solid ${gridColor}`,
            borderRadius: '8px',
            fontSize: '12px',
          }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={chartColor}
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorArea)"
        />
      </AreaChart>
    </VisibleResponsiveContainer>
  )
}
