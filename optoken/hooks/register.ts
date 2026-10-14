import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Effort, Measure, Settings, Step } from '../types'

const P = 'optoken'
const measure = atom({ plugin: 'optoken', key: 'measure' } as const, null)
const wanted = atom({ plugin: 'optoken', key: 'wanted' } as const, null)
const steps = atom({ plugin: 'optoken', key: 'steps' } as const, [])
const strikes = atom({ plugin: 'optoken', key: 'strikes' } as const, {})
const pending = atom({ plugin: 'optoken', key: 'pending' } as const, [])
const warned = atom({ plugin: 'optoken', key: 'warned' } as const, [])
const solo = atom({ plugin: 'optoken', key: 'solo' } as const, false)

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_EFFORT: Effort = 'low'
const SUBAGENT_EFFORT: Effort = 'medium'
const WEEK_MS = 7 * 24 * 3600 * 1000
const STRIKES = 3
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const DEFAULT_SETTINGS: Settings = { resume: 'ask', weekly: false }
const RESUMES = ['ask', 'always', 'never'] as const
const DAYS = ['both', '2', '1'] as const

// Fixed text: it sits in the system prompt, so it must never change between
// requests or it breaks the prompt cache. Live numbers go through the tool.
const BANNER = `
 ██████╗ ██████╗ ████████╗ ██████╗ ██╗  ██╗███████╗███╗   ██╗
██╔═══██╗██╔══██╗╚══██╔══╝██╔═══██╗██║ ██╔╝██╔════╝████╗  ██║
██║   ██║██████╔╝   ██║   ██║   ██║█████╔╝ █████╗  ██╔██╗ ██║
██║   ██║██╔═══╝    ██║   ██║   ██║██╔═██╗ ██╔══╝  ██║╚██╗██║
╚██████╔╝██║        ██║   ╚██████╔╝██║  ██╗███████╗██║ ╚████║
 ╚═════╝ ╚═╝        ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
   Same results. Fewer tokens.
                                              BY ZEROFPSYT`

// Sent once when the user types "OpToken": the settings menu.
const MENU = `The user opened the OpToken settings menu. Show this banner first, as a code block, and nothing else before the questions:
${BANNER}

Then ask these questions one at a time with AskUserQuestion (multiple choice, in the user's language, header "OpToken · Ajustes (n/4)"), and skip 3 and 4 when the answer to 2 is no:
1. When the user asks you to keep working without them, do you resume after the usage limit resets? Ask each time (recommended) / Always / Never.
2. Use the weekly limit that is about to expire unused? A cloud session opens by itself before the weekly reset and does small, safe tasks of one project. Yes (recommended) / No.
3. Which project? Offer the user's projects, most recent first: cloud repositories (list_repos, when that tool exists) and local ones (folders under ~/.claude/projects that still exist). The routine runs in the cloud, so the project needs a GitHub repository.
4. When? Both days (recommended) / 2 days before the reset / 1 day before, with the times in the user's local time, computed from the seven_day reset in \`effort\` status.

Then save the answers with \`optoken\` settings_set, set up the weekly routine with the weekly skill (optoken:weekly) (or remove it when the answer to 2 is no) and confirm in one line.`

const DIRECTIVE = `# OpToken (budget self-regulation)

Goal: the best result at the lowest cost. The \`effort\` tool (optoken plugin) sets your reasoning effort for the next requests and reports the usage limits. Effort starts at low and returns to low after every answer.

1. Conversation and questions: stay at low.
2. When you decide to actually solve, build or change something: first call \`effort\` with high, then plan. When a later turn continues approved work, set its effort again first.
3. The plan states, in one short line to the user: size (S / M / L), estimated cost as % of the 5-hour window, the effort to execute it (the lowest that executes without errors), and what you will delegate and to which model. Then set that effort.
4. While working: if the rest is mechanical, lower the effort; if something turns hard, raise it. A change applies from the next request, so no work is lost.
5. Limits, with the user present: before a big step compare its estimated cost with the margin left (\`effort\` with status). When the margin gets short, tell the user in one line; they decide whether to go on.
6. Working alone: only after the user explicitly asks you to keep working without them (e.g. "keep going, I'm off to bed"). Then call \`optoken\` with solo_start (solo_stop when they are back) and follow what it answers. Pick work you can finish before 95% of the 5-hour window: large tasks with a wide margin, small ones with little; when nothing fits, pause. At 95% or on a pause: save the state (commit + push), schedule the continuation as the resume setting says and tell the user in one line.
7. Delegation (this counts as the user's permission): spawn subagents without asking for broad searches, independent parallel work or a fresh-eyes review; never for small tasks, since a subagent starts cold. Haiku for broad or mechanical searches, Sonnet for simple code with a plan, Opus for planning and diagnosis. Subagents run at medium effort.
8. When the plugin flags trial and error: switch to high, redo the diagnosis from scratch and explain the new approach before continuing.
9. Read only what you need (search, read parts, never reread).`

function percent(m: Measure | null, kind: string): number | undefined {
  return m?.limits.find(l => l.kind === kind)?.percentUsed
}

function paceText(pace: number | undefined): string {
  if (pace === undefined) return ''
  if (pace > 5) return ` (adelantado ${Math.round(pace)})`
  if (pace < -5) return ` (atrasado ${Math.round(-pace)})`
  return ' (al día)'
}

function line(m: Measure | null, effort: string): string {
  const five = percent(m, 'five_hour')
  const week = percent(m, 'seven_day')
  const limits = m?.limits.length
    ? [five !== undefined ? `5h ${five}%` : '', week !== undefined ? `sem ${week}%${paceText(m.pace)}` : '']
        .filter(Boolean)
        .join(' · ')
    : 'límites: sin dato'
  const ctx = m?.contextTokens !== undefined ? ` · ctx ${Math.round(m.contextTokens / 1000)}k` : ''
  return `${limits} · esfuerzo ${effort}${ctx}`
}

function status(m: Measure | null, w: Effort | null): string {
  const resets = (m?.limits ?? []).map(l => `${l.kind} resets at ${l.resetsAt ?? '?'}`).join('; ')
  const pace =
    m?.pace === undefined
      ? ''
      : `\nWeekly pace: ${m.pace > 0 ? '+' : ''}${Math.round(m.pace)} points against the time elapsed (negative = limit left unused).`
  return `${line(m, w ?? DEFAULT_EFFORT)}\n${resets}${pace}`
}

function toMeasure(
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
  contextTokens: number | undefined,
  now: number,
): Measure {
  const limits = rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
  const week = limits.find(l => l.kind === 'seven_day')
  let pace: number | undefined
  if (week?.resetsAt) {
    const left = Date.parse(week.resetsAt) - now
    if (Number.isFinite(left)) pace = week.percentUsed - (1 - Math.min(Math.max(left / WEEK_MS, 0), 1)) * 100
  }
  return { limits, contextTokens, pace }
}

function atLimit(s: Settings): string {
  const how = 'schedule the continuation at the 5-hour reset plus 10 minutes and tell the user in one line.'
  if (s.resume === 'never') return 'stop without scheduling a continuation (resume setting: never).'
  if (s.resume === 'always') return how
  return `if the user said to resume when they handed over, ${how} Otherwise stop.`
}

async function getSettings($: { store: { get: (k: string) => Promise<unknown> } }): Promise<Settings> {
  const v = (await $.store.get('settings')) as Partial<Settings> | undefined
  return { ...DEFAULT_SETTINGS, ...(v ?? {}) }
}

function resumeText(s: Settings): string {
  if (s.resume === 'never') return 'Resume setting: never. At 95% or on a pause, save the state and stop; do not schedule a continuation.'
  const how =
    'schedule the continuation at the 5-hour reset plus 10 minutes (resetsAt in `effort` status; send_later in cloud sessions, a one-shot CronCreate locally)'
  if (s.resume === 'always') return `Resume setting: always. At 95% or on a pause, save the state and ${how}.`
  return `Resume setting: ask. Ask the user now, once, whether to resume after the limit (yes / no). If yes, at 95% or on a pause, save the state and ${how}; if no, save the state and stop.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'effort',
      description:
        'OpToken: sets the reasoning effort for the next requests (low, medium, high, xhigh, max) or, with "status", only reports the usage limits, weekly pace, effort and context.',
      inputSchema: {
        type: 'object',
        properties: { effort: { type: 'string', enum: [...EFFORTS, 'status'] } },
        required: ['effort'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'optoken',
      description:
        'OpToken: settings_get / settings_set read or save the user settings (resume, weekly, project, days); solo_start / solo_stop mark when you work alone after the user explicitly asked you to.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['settings_get', 'settings_set', 'solo_start', 'solo_stop'] },
          resume: { type: 'string', enum: [...RESUMES] },
          weekly: { type: 'boolean' },
          project: { type: 'string', description: 'GitHub owner/repo for the weekly routine' },
          days: { type: 'string', enum: [...DAYS] },
        },
        required: ['action'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'optoken', description: 'Muestra límites, ritmo, esfuerzo y últimos pasos de OpToken' })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    return { sections: [...res.sections, { id: `${P}:directive`, text: DIRECTIVE, scope: 'session' }] }
  })

  // Warnings also ride on the next prompt, for turns that use no tool.
  on('prompt.submit', async ($, e, next) => {
    if (/^\s*op\s*token\s*$/i.test(e.text)) return next({ ...e, context: [...(e.context ?? []), MENU] })
    const queued = await read($, pending)
    if (!queued.length) return next(e)
    await update($, pending, () => [])
    return next({ ...e, context: [...(e.context ?? []), ...queued] })
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    // Edits to one file are counted per turn; a failing command keeps its count
    // across turns ("try again") until it succeeds.
    await update($, strikes, s => Object.fromEntries(Object.entries(s).filter(([k]) => k.includes('|cmd:'))))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const main = e.agentId === undefined
    const notes: string[] = []
    if (main) {
      const queued = await read($, pending)
      if (queued.length) {
        notes.push(...queued)
        await update($, pending, () => [])
      }
    }

    if (e.tool === `mcp__${P}__effort`) {
      const value = (e as unknown as { effort?: string }).effort
      const chosen = EFFORTS.find(x => x === value)
      if (chosen) await update($, wanted, () => chosen)
      const text = status(await read($, measure), await read($, wanted))
      return { result: chosen ? `Effort set to ${chosen}.\n${text}` : text, ...(notes.length ? { context: notes } : {}) }
    }

    if (e.tool === `mcp__${P}__optoken`) {
      const a = e as unknown as { action?: string; resume?: string; weekly?: boolean; project?: string; days?: string }
      let s = await getSettings($)
      let text: string
      if (a.action === 'settings_set') {
        s = {
          resume: RESUMES.find(x => x === a.resume) ?? s.resume,
          weekly: typeof a.weekly === 'boolean' ? a.weekly : s.weekly,
          project: a.project ?? s.project,
          days: DAYS.find(x => x === a.days) ?? s.days,
        }
        await $.store.set('settings', s)
        text = 'Settings saved.'
      } else if (a.action === 'solo_start') {
        await update($, solo, () => true)
        text = `Working alone.\n${resumeText(s)}`
      } else if (a.action === 'solo_stop') {
        await update($, solo, () => false)
        text = 'Back with the user: warn about the margin, they decide.'
      } else text = 'Settings:'
      return { result: `${text}\n${JSON.stringify(s)}`, ...(notes.length ? { context: notes } : {}) }
    }

    const res = await next(e)
    if (res.deny !== undefined) return res

    let key: string | undefined
    if (e.tool === 'Bash') {
      if (res.isError === true) key = `cmd:${e.command.trim()}`
      else {
        const ok = `${e.agentId ?? 'main'}|cmd:${e.command.trim()}`
        await update($, strikes, s => (ok in s ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== ok)) : s))
      }
    }
    else if (EDIT_TOOLS.includes(e.tool)) {
      const path = (e as unknown as { file_path?: string; notebook_path?: string })
      key = `file:${path.file_path ?? path.notebook_path ?? ''}`
    }
    if (key) {
      const id = `${e.agentId ?? 'main'}|${key}`
      let count = 0
      await update($, strikes, s => {
        count = (s[id] ?? 0) + 1
        return { ...s, [id]: count }
      })
      if (count % STRIKES === 0) {
        const what = key.startsWith('cmd:') ? `the same command failed ${count} times` : `the same file was edited ${count} times`
        notes.push(
          `OpToken: ${what} in a row. If this is trial and error, stop: call effort with high, redo the diagnosis from scratch and explain the new approach before continuing. If it is planned work in several parts, carry on.`,
        )
        if (main) $.ui.toast(`OpToken: posible prueba y error (${count}×)`)
      }
    }

    return notes.length ? { ...res, context: [...(res.context ?? []), ...notes] } : res
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const m = toMeasure(e.rateLimits, e.context.tokens, await $.clock.now())
    const before = percent(await read($, measure), 'five_hour')
    await update($, measure, () => m)

    const five = percent(m, 'five_hour')
    if (five !== undefined) {
      if (before !== undefined && five < before) await update($, warned, () => [])
      const done = await read($, warned)
      const notes: string[] = []
      if (five >= 95 && !done.includes(95)) {
        if (await read($, solo)) {
          notes.push(`OpToken: the 5-hour window is at ${five}%. Stop now: save the state (commit + push), then ${atLimit(await getSettings($))}`)
          $.ui.toast(`OpToken: ventana de 5 h al ${five}%, cerrando`)
        } else {
          notes.push(`OpToken: the 5-hour window is at ${five}%. Tell the user in one line; they decide whether to go on.`)
          $.ui.toast(`OpToken: ventana de 5 h al ${five}%`)
        }
      } else if (five >= 80 && !done.includes(80)) {
        notes.push(
          `OpToken: the 5-hour window is at ${five}%. Before each new step, check that its estimated cost fits the margin left.`,
        )
      }
      if (notes.length) {
        await update($, warned, w => [...w, five >= 95 ? 95 : 80, 80])
        await update($, pending, p => [...p, ...notes])
      }
    }

    $.ui.status(line(m, (await read($, wanted)) ?? DEFAULT_EFFORT))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const w = (await read($, wanted)) ?? DEFAULT_EFFORT
    const override = e.effort !== undefined
    const sent = e.agentId === undefined ? w : SUBAGENT_EFFORT
    const res = yield* next(override ? { ...e, effort: sent } : e)
    const u = res.usage
    const step: Step = {
      agent: e.agentId ?? 'main',
      model: e.model,
      sent: override ? sent : e.effort === undefined ? undefined : String(e.effort),
      read: u?.cache_read_input_tokens ?? 0,
      wrote: u?.cache_creation_input_tokens ?? 0,
      input: u?.input_tokens ?? 0,
    }
    await update($, steps, s => [...s, step].slice(-10))
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId || e.reason !== 'answer') return res
    // Fresh figures: this turn's session.measure arrives after the line is drawn.
    let m = await read($, measure)
    try {
      const u = await $.session.usage()
      if (u.rateLimits.length) m = toMeasure(u.rateLimits, u.context.tokens, await $.clock.now())
    } catch {}
    const used = (await read($, wanted)) ?? DEFAULT_EFFORT
    await update($, wanted, () => null)
    return { ...res, text: `[optoken] ${line(m, used)}` }
  })

  on('command.run', { command: 'optoken' }, async $ => {
    const rows = (await read($, steps)).map(
      x => `${x.agent} ${x.model} esfuerzo=${x.sent ?? '—'} caché=${x.read} escrito=${x.wrote} nuevo=${x.input}`,
    )
    return { text: [status(await read($, measure), await read($, wanted)), 'Últimos pasos:', ...rows].join('\n') }
  })
}
