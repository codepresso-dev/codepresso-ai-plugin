import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Board, Mood, Todo } from '../types'

const PANE = 'secretary'
const TOOL = 'mcp__secretary__set_board'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const FIRST_SLOT_HOUR = 9 // 09:30
const LAST_SLOT_HOUR = 17 // 17:30

const EMPTY: Board = { todos: [], mood: 'sleep', say: '아직 체크인 전이에요. /secretary 로 불러 주세요.' }
const board = atom({ plugin: 'secretary', key: 'board' } as const, EMPTY, { shape: 'board-1' })

const FACES: Record<Mood, string> = {
  happy: '(•ᴗ•)',
  focus: '(•̀ᴗ•́)و',
  cheer: '(ﾉ◕ヮ◕)ﾉ*:・ﾟ✧',
  worry: '(・_・;)',
  sleep: '(－_－) zzZ',
}

/** 평일 KST 9:30~17:30 사이면 이번 시간대 슬롯을 돌려준다. 정각 30분 기준. */
export function findSlot(now: number): { key: string; day: string; hour: number } | undefined {
  const kst = new Date(now + KST_OFFSET_MS)
  const weekday = kst.getUTCDay()
  if (weekday === 0 || weekday === 6) return undefined
  const hour = kst.getUTCMinutes() >= 30 ? kst.getUTCHours() : kst.getUTCHours() - 1
  if (hour < FIRST_SLOT_HOUR || hour > LAST_SLOT_HOUR) return undefined
  const day = kst.toISOString().slice(0, 10)

  return { key: `${day}-${hour}`, day, hour }
}

function buildCheckInPrompt(kind: 'morning' | 'hourly' | 'wrapup', since: string | undefined): string {
  const sinceText = since ?? '오늘 00:00 KST'
  const common = [
    `[비서 체크인] 너는 사용자의 업무 비서야. 사용자를 "주인님"이라고 부르고, 짧고 다정한 대화체로 말해.`,
    `1. 마지막 체크인(${sinceText}) 이후 내가 작성한 PR 중 develop 또는 main 에 머지된 것을 gh 로 찾아.`,
    `   (예: gh search prs --author @me --merged --merged-at ">=<ISO>" --json title,url,headRefName)`,
    `   PR 제목·브랜치의 TSK 번호로 Notion 태스크를 찾아 상태를 완료 쪽으로 바꾸고, 바꿨다고 알려줘.`,
    `2. Notion 태스크 보드에서 내 진행 중·할 일 태스크를 다시 읽어 남은 일을 리마인드해.`,
    `3. Gmail·Google Chat 에서 지난 체크인 이후 온 긴급 요청이 보이면, 태스크로 추가할지 물어봐. 묻기 전에 만들지 마.`,
    `4. 마지막에 ${TOOL} 를 호출해 패널을 갱신해. todos 는 Notion 태스크(taskId 포함)와 내가 쪼갠 하위 할 일(parent)을 함께 담아.`,
    `연결이 안 되는 도구는 건너뛰고 "○○는 못 봤어요" 한 줄만 남겨. 전체 답은 10줄 이내.`,
  ]
  if (kind === 'morning') {
    common.splice(1, 0, `0. 오늘 첫 체크인이야. 오늘 일정(Google Calendar), 이번 주 온콜 여부, 리뷰 대기 PR 을 먼저 짧게 브리핑해.`)
  }
  if (kind === 'wrapup') {
    common.push(`오늘 마지막 체크인이야. 오늘 끝낸 일과 내일로 넘어가는 일을 정리해 줘.`)
  }

  return common.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'secretary', description: '비서 패널을 열고 지금 바로 체크인한다' })
    await $.tool.register({
      name: 'set_board',
      description: '비서 패널의 할 일 목록·캐릭터 표정·한마디를 갱신한다. 체크인 끝에 호출.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                isDone: { type: 'boolean' },
                taskId: { type: 'string', description: 'Notion TSK 번호 (있으면)' },
                parent: { type: 'string', description: '하위 할 일이면 부모 title' },
              },
              required: ['title', 'isDone'],
            },
          },
          mood: { type: 'string', enum: Object.keys(FACES) },
          say: { type: 'string', description: '캐릭터가 할 한마디 (40자 이내)' },
        },
        required: ['todos', 'mood', 'say'],
      },
    })

    const saved = (await $.store.get('board')) as Board | undefined
    if (saved) await update($, board, () => saved)
    void $.ui.open({ id: PANE, title: '비서' })

    // ponytail: 1분 폴링. 세션 여러 개면 store 읽고-쓰기 사이에 드물게 중복 체크인 가능
    $.clock.every(60_000, async () => {
      const slot = findSlot(await $.clock.now())
      if (!slot || (await $.store.get('lastSlot')) === slot.key) return
      const lastDay = (await $.store.get('lastDay')) as string | undefined
      const since = (await $.store.get('lastCheckAt')) as string | undefined
      await $.store.set('lastSlot', slot.key)
      await $.store.set('lastDay', slot.day)
      await $.store.set('lastCheckAt', new Date().toISOString())
      const kind = lastDay !== slot.day ? 'morning' : slot.hour === LAST_SLOT_HOUR ? 'wrapup' : 'hourly'
      void $.ui.notify(kind === 'morning' ? '좋은 아침이에요, 주인님!' : '체크인 시간이에요', { title: '비서' })
      void $.prompt.submit({ text: buildCheckInPrompt(kind, lastDay === slot.day ? since : undefined) })
    })

    return next(e)
  })

  on('command.run', { command: 'secretary' }, async $ => {
    await $.ui.open({ id: PANE, title: '비서' })
    const since = (await $.store.get('lastCheckAt')) as string | undefined
    await $.store.set('lastCheckAt', new Date().toISOString())
    void $.prompt.submit({ text: buildCheckInPrompt('hourly', since) })

    return { text: '비서를 불렀어요.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { todos: Todo[]; mood: Mood; say: string }
    const next: Board = {
      todos: input.todos ?? [],
      mood: FACES[input.mood] ? input.mood : 'happy',
      say: input.say ?? '',
      checkedAt: await $.clock.now(),
    }
    await update($, board, () => next)
    await $.store.set('board', next)

    return { result: '패널을 갱신했어요.' }
  }).catch(() => ({ deny: '비서 패널 갱신에 실패했어요.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { todos, mood, say, checkedAt } = await read($, board)
    const doneCount = todos.filter(todo => todo.isDone).length
    const checkedText = checkedAt
      ? new Date(checkedAt + KST_OFFSET_MS).toISOString().slice(11, 16)
      : '--:--'

    return (
      <Box flexDirection="column">
        <Text bold color="magenta">{FACES[mood]}</Text>
        <Text>“{say}”</Text>
        <Text dimColor>
          {todos.length > 0 ? `${doneCount}/${todos.length} 완료` : '할 일 없음'} · 마지막 체크인 {checkedText}
        </Text>
        {todos.map(todo => (
          <Text dimColor={todo.isDone}>
            {todo.parent ? '   ' : ''}
            {todo.isDone ? '☑' : '☐'} {todo.taskId ? `[${todo.taskId}] ` : ''}
            {todo.title}
          </Text>
        ))}
      </Box>
    )
  })
}
