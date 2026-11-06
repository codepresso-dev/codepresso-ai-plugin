import { expect, test } from 'claude-code/testing'

import { toBubble } from '../hooks/register'

test('답변 첫 문장만 말풍선에 넣는다', async () => {
  expect(toBubble('## 결론\n\n패널이 잘 떠요. 다음은 PR 이에요.')).toBe('결론')
  expect(toBubble('- **머지 완료**: #511')).toBe('머지 완료: #511')
  expect(toBubble('```\ncode\n```\n테스트 통과했어요! 다음 단계예요.')).toBe('테스트 통과했어요!')
  expect(toBubble('가'.repeat(50))).toBe(`${'가'.repeat(39)}…`)
  expect(toBubble('   \n')).toBe('')
})
