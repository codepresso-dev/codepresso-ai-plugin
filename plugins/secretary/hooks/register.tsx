import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Board, Mood, Todo } from '../types'

const PANE = 'secretary'
const TOOL = 'mcp__secretary__set_board'
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const FIRST_SLOT_HOUR = 9 // 09:30
const LAST_SLOT_HOUR = 17 // 17:30

const EMPTY: Board = { todos: [], mood: 'sleep', say: '아직 체크인 전이에요. /coco 로 불러 주세요.' }
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

const SAY_MAX = 40

/** 답변의 첫 문장을 말풍선 길이로 줄인다. 마크다운 기호·코드 블록은 뺀다. */
export function toBubble(answer: string): string {
  const line = answer
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map(text => text.replace(/^[\s#>*\-\d.]+/, '').replace(/[`*_]/g, '').trim())
    .find(text => text.length > 0)
  if (!line) return ''
  const sentence = line.split(/(?<=[.!?。])\s/)[0] ?? line

  return sentence.length > SAY_MAX ? `${sentence.slice(0, SAY_MAX - 1)}…` : sentence
}

const DEFAULT_TITLE = '개발자님'

const NUDGE_AFTER_MS = 30 * 60 * 1000
const NUDGE_EVERY_MS = 10 * 60 * 1000
const NUDGE_MARKER = '<!-- coco-nudge -->'

export type Review = { login: string; isBot: boolean; state: string; submittedAt: string }

/**
 * 코멘트를 남긴 뒤 내가 커밋을 올렸고, 30분이 지나도 approve 안 한 사람을 고른다.
 * 봇·나 자신은 빼고, 마지막 커밋 뒤에 이미 확인 요청을 남겼으면 아무도 고르지 않는다.
 */
export function findNudgeLogins(input: {
  me: string
  reviews: Review[]
  lastCommitAt: string
  lastNudgeAt?: string
  now: number
}): string[] {
  const commitAt = Date.parse(input.lastCommitAt)
  if (input.now - commitAt < NUDGE_AFTER_MS) return []
  if (input.lastNudgeAt && Date.parse(input.lastNudgeAt) >= commitAt) return []
  const latest = new Map<string, Review>()
  for (const review of input.reviews) {
    if (review.isBot || review.login === input.me || review.state === 'PENDING') continue
    const known = latest.get(review.login)
    if (!known || Date.parse(review.submittedAt) > Date.parse(known.submittedAt)) latest.set(review.login, review)
  }

  return [...latest.values()]
    .filter(review => review.state === 'CHANGES_REQUESTED' || review.state === 'COMMENTED')
    .filter(review => Date.parse(review.submittedAt) < commitAt)
    .map(review => review.login)
}

function buildCheckInPrompt(
  kind: 'morning' | 'hourly' | 'wrapup',
  since: string | undefined,
  userTitle: string | undefined,
): string {
  const sinceText = since ?? '오늘 00:00 KST'
  const titleRule = userTitle
    ? `사용자를 "${userTitle}"이라고 불러.`
    : `사용자를 "${DEFAULT_TITLE}"이라고 불러. 처음에 "어떻게 불러드릴까요? (기본: ${DEFAULT_TITLE})"라고 한 번 묻고, 답을 받으면 ${TOOL} 의 userTitle 에 "이름+님" 형태로 넣어.`
  const common = [
    `[비서 체크인] 너는 사용자의 업무 비서야. ${titleRule}`,
    `말투: 간결한 대화체. 비유는 쓰지 마. 10살도 이해할 쉬운 문장으로 써. 용어는 공식 이름(PR, 머지, Notion 태스크, 온콜, 리뷰 요청)을 그대로 써.`,
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
  let isBoardSetThisTurn = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'coco', description: '비서 패널을 열고 지금 바로 체크인한다' })
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
          userTitle: { type: 'string', description: '사용자가 알려준 호칭 (예: 홍길동님). 바꿀 때만 넣는다' },
        },
        required: ['todos', 'mood', 'say'],
      },
    })

    const saved = (await $.store.get('board')) as Board | undefined
    if (saved) await update($, board, () => saved)
    void $.ui.open({ id: PANE, title: '비서' }).then(opened => {
      if (!opened.isPlaced) $.ui.status(`비서 패널 대기 중 (${opened.reason}) — /coco 로 열기`)
    })

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
      const userTitle = (await $.store.get('userTitle')) as string | undefined
      void $.ui.notify(kind === 'morning' ? `좋은 아침이에요, ${userTitle ?? DEFAULT_TITLE}!` : '체크인 시간이에요', { title: '비서' })
      void $.prompt.submit({ text: buildCheckInPrompt(kind, lastDay === slot.day ? since : undefined, userTitle) })
    })

    // 코멘트 반영 뒤 30분 넘게 approve 가 없으면 리뷰어를 태그해 확인 요청을 남긴다.
    const gh = async (args: string[]) => {
      const ran = await $.process.run(['gh', ...args])
      if (ran.exitCode !== 0) throw new Error(ran.stderr.slice(0, 200))
      return ran.stdout
    }
    let isNudging = false
    $.clock.every(NUDGE_EVERY_MS, async () => {
      const now = await $.clock.now()
      if (isNudging || !findSlot(now)) return
      isNudging = true
      try {
        const me = (await gh(['api', 'user', '--jq', '.login'])).trim()
        const prs = JSON.parse(
          await gh(['search', 'prs', '--author', '@me', '--state', 'open', '--json', 'url,number,repository,isDraft', '--limit', '50']),
        ) as { url: string; number: number; isDraft: boolean; repository: { nameWithOwner: string } }[]
        for (const pr of prs.filter(one => !one.isDraft)) {
          const base = `repos/${pr.repository.nameWithOwner}`
          const reviews = (JSON.parse(await gh(['api', `${base}/pulls/${pr.number}/reviews?per_page=100`])) as {
            user: { login: string; type: string } | null
            state: string
            submitted_at: string
          }[]).flatMap(one => (one.user ? [{ login: one.user.login, isBot: one.user.type === 'Bot', state: one.state, submittedAt: one.submitted_at }] : []))
          // ponytail: 커밋 100개 넘는 PR 은 마지막 커밋을 못 볼 수 있음. 필요하면 --paginate
          const lastCommitAt = (await gh(['api', `${base}/pulls/${pr.number}/commits?per_page=100`, '--jq', '.[-1].commit.committer.date'])).trim()
          const nudgeTimes = await gh([
            'api', '--paginate', `${base}/issues/${pr.number}/comments?per_page=100`,
            '--jq', `.[] | select(.body | contains("${NUDGE_MARKER}")) | .created_at`,
          ])
          const lastNudgeAt = nudgeTimes.split('\n').filter(Boolean).sort().at(-1)
          const logins = findNudgeLogins({ me, reviews, lastCommitAt, lastNudgeAt, now })
          if (logins.length === 0) continue
          const mentions = logins.map(login => `@${login}`).join(' ')
          await gh(['pr', 'comment', pr.url, '--body', `${mentions} 코멘트 반영을 완료했습니다. PR 확인 부탁드립니다.\n\n${NUDGE_MARKER}`])
          $.ui.toast(`${pr.repository.nameWithOwner}#${pr.number} 에 ${mentions} 확인 요청을 남겼어요`)
        }
      } catch (error) {
        $.ui.log(`coco: PR 확인 요청 실패 — ${String(error)}`, { to: 'debug' })
      } finally {
        isNudging = false
      }
    })

    return next(e)
  })

  on('command.run', { command: 'coco' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: '비서' })
    const since = (await $.store.get('lastCheckAt')) as string | undefined
    await $.store.set('lastCheckAt', new Date().toISOString())
    const userTitle = (await $.store.get('userTitle')) as string | undefined
    void $.prompt.submit({ text: buildCheckInPrompt('hourly', since, userTitle) })

    return { text: opened.isPlaced ? '비서를 불렀어요.' : `비서 패널을 못 열었어요: ${opened.reason}` }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as { todos: Todo[]; mood: Mood; say: string; userTitle?: string }
    if (input.userTitle?.trim()) await $.store.set('userTitle', input.userTitle.trim())
    const next: Board = {
      todos: input.todos ?? [],
      mood: FACES[input.mood] ? input.mood : 'happy',
      say: input.say ?? '',
      checkedAt: await $.clock.now(),
    }
    await update($, board, () => next)
    await $.store.set('board', next)
    isBoardSetThisTurn = true

    return { result: '패널을 갱신했어요.' }
  }).catch(() => ({ deny: '비서 패널 갱신에 실패했어요.' }))

  // 대화가 끝날 때마다 답변 첫 문장을 말풍선에 띄운다. 체크인이 직접 정한 한마디는 덮지 않는다.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return done
    if (isBoardSetThisTurn) {
      isBoardSetThisTurn = false
      return done
    }
    const say = toBubble(e.answer)
    if (say) {
      await update($, board, current => ({ ...current, say }))
      await $.store.set('board', await read($, board))
    }

    return done
  })

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
