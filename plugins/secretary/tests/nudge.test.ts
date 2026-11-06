import { expect, test } from 'claude-code/testing'

import { findNudgeLogins } from '../hooks/register'

const commitAt = '2026-11-06T03:00:00Z'
const now = Date.parse('2026-11-06T03:31:00Z')
const review = (login: string, state: string, submittedAt: string, isBot = false) => ({ login, isBot, state, submittedAt })

test('코멘트 뒤 커밋하고 30분 지나면 approve 안 한 사람만 고른다', async () => {
  const reviews = [
    review('alice', 'CHANGES_REQUESTED', '2026-11-06T02:00:00Z'),
    review('bob', 'COMMENTED', '2026-11-06T02:10:00Z'),
    review('bob', 'APPROVED', '2026-11-06T02:20:00Z'),
    review('coderabbitai', 'COMMENTED', '2026-11-06T02:00:00Z', true),
    review('me', 'COMMENTED', '2026-11-06T02:00:00Z'),
    review('carol', 'COMMENTED', '2026-11-06T03:10:00Z'),
  ]
  expect(findNudgeLogins({ me: 'me', reviews, lastCommitAt: commitAt, now })).toEqual(['alice'])
})

test('30분 전이거나 이미 확인 요청을 남겼으면 아무도 안 고른다', async () => {
  const reviews = [review('alice', 'COMMENTED', '2026-11-06T02:00:00Z')]
  expect(findNudgeLogins({ me: 'me', reviews, lastCommitAt: commitAt, now: Date.parse('2026-11-06T03:29:00Z') })).toEqual([])
  expect(findNudgeLogins({ me: 'me', reviews, lastCommitAt: commitAt, lastNudgeAt: '2026-11-06T03:30:00Z', now })).toEqual([])
  expect(findNudgeLogins({ me: 'me', reviews, lastCommitAt: commitAt, lastNudgeAt: '2026-11-06T02:30:00Z', now })).toEqual(['alice'])
})
