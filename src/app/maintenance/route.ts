import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

/**
 * GET /maintenance — Maintenance mode page (Edge runtime, ~50ms globally).
 *
 * Shown when Edge Config feature.maintenanceMode is true.
 * The middleware rewrites all HTML page requests to this route.
 */
export async function GET() {
  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ระบบปิดบำรุง — IT Asset Management</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Sarabun', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container {
      max-width: 480px;
      text-align: center;
      animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    h1 {
      font-size: 1.75rem;
      margin-bottom: 0.5rem;
      color: #fb923c;
    }
    p {
      font-size: 1rem;
      color: #cbd5e1;
      line-height: 1.6;
      margin-bottom: 1.5rem;
    }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #334155;
      font-size: 0.875rem;
      color: #64748b;
    }
    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid #334155;
      border-top-color: #fb923c;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
  <meta http-equiv="refresh" content="60" />
</head>
<body>
  <div class="container">
    <div class="icon">🔧</div>
    <h1>ระบบอยู่ในช่วงปิดบำรุง</h1>
    <p>ทีมงานกำลังปรับปรุงระบบเพื่อให้บริการที่ดีขึ้น<br/>กรุณาลองเข้าใช้ใหม่ภายหลัง</p>
    <div class="spinner"></div>
    <p style="font-size: 0.875rem; color: #94a3b8;">
      หน้านี้จะรีเฟรชอัตโนมัติทุก 60 วินาที
    </p>
    <div class="footer">
      <p>IT Asset Management — Powered by PNG TEAM</p>
    </div>
  </div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Retry-After': '300',
    },
  })
}
