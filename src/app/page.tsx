// src/app/page.tsx — Server component
// Uses force-dynamic to skip prerendering (browser-only libs crash SSR).
// Client component (home-client.tsx) handles actual rendering.

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { HomePage } from './home-client'

export default function Page() {
  return <HomePage />
}
