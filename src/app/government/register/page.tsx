import type { Metadata } from 'next'
import { GovernmentRegisterWorkspace } from '@/components/government/register-workspace'
export const metadata: Metadata={title:'ทะเบียนคุมทรัพย์สิน — Smart-Asset',robots:{index:false,follow:false}}
export default function Page(){return <GovernmentRegisterWorkspace/>}
