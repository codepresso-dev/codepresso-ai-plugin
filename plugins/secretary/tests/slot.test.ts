import { expect, test } from 'claude-code/testing'

import { findSlot } from '../hooks/register'

// KST = UTC+9. 2026-11-06 은 금요일, 2026-11-07 은 토요일.
const kst = (iso: string) => Date.parse(`${iso}+09:00`)

test('평일 9:30~17:59 만 슬롯이 잡힌다', async () => {
  expect(findSlot(kst('2026-11-06T09:29:00'))).toBe(undefined)
  expect(findSlot(kst('2026-11-06T09:30:00'))?.key).toBe('2026-11-06-9')
  expect(findSlot(kst('2026-11-06T10:15:00'))?.key).toBe('2026-11-06-9')
  expect(findSlot(kst('2026-11-06T17:30:00'))?.hour).toBe(17)
  expect(findSlot(kst('2026-11-06T18:30:00'))).toBe(undefined)
  expect(findSlot(kst('2026-11-07T10:30:00'))).toBe(undefined)
})
