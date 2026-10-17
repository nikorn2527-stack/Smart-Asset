import { describe, expect, it } from 'vitest'
import { bangkokDate, computeNextRunDate, generateScheduledDatesForMonth as monthDates, upcomingPMDates, validatePMScheduleRule, serializePMChecklist } from '@/lib/pm-schedule'
const on = (date: string) => new Date(date + 'T00:00:00Z')
describe('PM civil-date recurrence', () => {
  it('uses the Thai calendar day at UTC midnight boundaries', () => {
    expect(bangkokDate(new Date('2026-10-15T18:00:00Z'))).toBe('2026-10-16')
  })
  it('anchors every N days to plan start across month boundaries', () => {
    const rule={frequency:'custom',intervalDays:10,startDate:'2026-01-28'}
    expect(monthDates(rule,2026,2)).toEqual(['2026-02-07','2026-02-17','2026-02-27'])
    expect(computeNextRunDate(rule,on('2026-02-01'))).toBe('2026-02-07')
  })
  it('includes the first planned date and never runs before start', () => {
    expect(monthDates({frequency:'daily',startDate:'2026-02-27'},2026,2)).toEqual(['2026-02-27','2026-02-28'])
    expect(computeNextRunDate({frequency:'daily',startDate:'2026-03-10'},on('2026-02-01'))).toBe('2026-03-10')
  })
  it('uses one inclusive next-occurrence rule for all frequencies', () => {
    expect(computeNextRunDate({frequency:'daily'},on('2026-10-16'))).toBe('2026-10-16')
    expect(computeNextRunDate({frequency:'weekly',weekday:'FRI'},on('2026-10-16'))).toBe('2026-10-16')
    expect(computeNextRunDate({frequency:'monthly',dayOfMonth:16},on('2026-10-16'))).toBe('2026-10-16')
  })
  it('clamps the 31st to month end, including leap years', () => {
    expect(monthDates({frequency:'monthly',dayOfMonth:31},2026,2)).toEqual(['2026-02-28'])
    expect(monthDates({frequency:'monthly',dayOfMonth:31},2028,2)).toEqual(['2028-02-29'])
    expect(computeNextRunDate({frequency:'monthly',dayOfMonth:31},on('2026-02-01'))).toBe('2026-02-28')
  })
  it('orders quarterly occurrences chronologically when a cycle wraps the year', () => {
    expect(computeNextRunDate({frequency:'quarterly',startMonth:10,dayOfMonth:1},on('2026-01-02'))).toBe('2026-04-01')
    expect(computeNextRunDate({frequency:'half_yearly',startMonth:10,dayOfMonth:1},on('2026-01-02'))).toBe('2026-04-01')
  })
  it('yearly dates clamp on non-leap years', () => {
    expect(computeNextRunDate({frequency:'yearly',startMonth:2,dayOfMonth:29},on('2027-01-01'))).toBe('2027-02-28')
  })
  it('preview and monthly calendar agree without timezone drift', () => {
    const rule={frequency:'custom',intervalDays:3,startDate:'2026-02-01'}
    const preview=upcomingPMDates(rule,5,on('2026-02-01'))
    expect(preview).toEqual(monthDates(rule,2026,2).slice(0,5))
  })
  it.each([
    {frequency:'unknown'}, {frequency:'custom',intervalDays:0,startDate:'2026-01-01'},
    {frequency:'custom',intervalDays:1.5,startDate:'2026-01-01'}, {frequency:'custom',intervalDays:3},
    {frequency:'monthly',dayOfMonth:32}, {frequency:'weekly',weekday:'INVALID'},
    {frequency:'yearly',startMonth:13}, {frequency:'daily',startDate:'2026-02-30'},
  ])('rejects invalid recurrence %j', rule => expect(()=>validatePMScheduleRule(rule)).toThrow())
  it('rejects invalid calendar months instead of silently rolling over',()=>expect(()=>monthDates({frequency:'daily'},2026,13)).toThrow())
})

it('validates required checklist definitions before saving a plan',()=>{
 expect(()=>serializePMChecklist([{id:'same',label:'หนึ่ง',required:true},{id:'same',label:'สอง',required:true}])).toThrow()
 expect(()=>serializePMChecklist('bad json')).toThrow()
 expect(()=>serializePMChecklist([{id:'a',label:'ตรวจ',required:'false'}])).toThrow()
 expect(serializePMChecklist([{id:'a',label:' ตรวจ ',required:true}])).toBe('[{"id":"a","label":"ตรวจ","required":true}]')
})
