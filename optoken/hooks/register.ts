import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Effort, Measure, Plan, Settings, Step } from '../types'

const P = 'optoken'
const measure = atom({ plugin: 'optoken', key: 'measure' } as const, null)
const wanted = atom({ plugin: 'optoken', key: 'wanted' } as const, null)
const steps = atom({ plugin: 'optoken', key: 'steps' } as const, [])
const strikes = atom({ plugin: 'optoken', key: 'strikes' } as const, {})
const pending = atom({ plugin: 'optoken', key: 'pending' } as const, [])
const warned = atom({ plugin: 'optoken', key: 'warned' } as const, [])
const solo = atom({ plugin: 'optoken', key: 'solo' } as const, false)
const plan = atom({ plugin: 'optoken', key: 'plan' } as const, null)
const highCalls = atom({ plugin: 'optoken', key: 'highCalls' } as const, 0)
const failRun = atom({ plugin: 'optoken', key: 'failRun' } as const, 0)
const worked = atom({ plugin: 'optoken', key: 'worked' } as const, false)
const idle = atom({ plugin: 'optoken', key: 'idle' } as const, 0)

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_EFFORT: Effort = 'low'
const SUBAGENT_EFFORT: Effort = 'medium'
const WEEK_MS = 7 * 24 * 3600 * 1000
const STRIKES = 3
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit']
const DEFAULT_SETTINGS: Settings = { resume: 'ask', weekly: false }
const SIZES = ['S', 'M', 'L'] as const
/** Llamadas en esfuerzo alto, con plan en curso, antes de preguntar si ya se puede bajar. */
const HIGH_CALLS = 8
/** Turnos seguidos sin cambios, trabajando solo, antes de sugerir pausar las rutinas. */
const IDLE_TURNS = 3
/** Tareas que se guardan en el registro (`/optoken`). */
const LOG_MAX = 50
const HIGH: Effort[] = ['high', 'xhigh', 'max']
/** Commits: la otra forma de cambiar el proyecto (además de editar archivos). */
const COMMIT = /\bgit\s+(-C\s+\S+\s+)?commit\b/
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
2. Every task that changes something (each one, also the next one in the same turn): first call \`effort\` with high and think the cheapest way to the best result, then call \`plan\` with start: task, size (S / M / L), estimated cost as % of the 5-hour window, the effort to execute it (the lowest that executes without errors) and what you will delegate and to which model. \`plan\` sets that effort; tell the user the plan in one short line. Edits and commits are refused while no plan is open.
3. When the task is done, call \`plan\` with done: it measures the real cost against your estimate. Close it before starting the next task.
4. While working: if the rest is mechanical, lower the effort; if something turns hard, raise it. A change applies from the next request, so no work is lost.
5. Limits, with the user present: before a big step compare its estimated cost with the margin left (\`effort\` with status). When the margin gets short, tell the user in one line; they decide whether to go on.
6. Working alone: only after the user explicitly asks you to keep working without them (e.g. "keep going, I'm off to bed"). Then call \`optoken\` with solo_start (solo_stop when they are back) and follow what it answers. Pick work you can finish before 95% of the 5-hour window: large tasks with a wide margin, small ones with little; when nothing fits, pause. At 95% or on a pause: save the state (commit + push), schedule the continuation as the resume setting says and tell the user in one line.
7. Delegation (this counts as the user's permission): spawn subagents without asking for broad searches, independent parallel work or a fresh-eyes review; never for small tasks, since a subagent starts cold. Haiku for broad or mechanical searches, Sonnet for simple code with a plan, Opus for planning and diagnosis. Subagents run at medium effort.
8. When the plugin flags trial and error: switch to high, redo the diagnosis from scratch and explain the new approach before continuing.
9. Read only what you need (search, read parts, never reread).
10. Check before spending: confirm a hypothesis with the smallest test that can disprove it before a fix; run long suites (browser, end to end) once at the end, not after every small change.
11. Working with another session: before taking a task, read what it has taken and announce yours; never both on the same task without agreeing who touches which files.`

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

function planLine(p: Plan): string {
  const real = p.real === undefined ? '' : ` → real ${p.real}%`
  return `${p.size} · ${p.task} · estimado ${p.cost}%${real} · esfuerzo ${p.effort}${p.delegate ? ` · delega: ${p.delegate}` : ''}`
}

async function getLog($: { store: { get: (k: string) => Promise<unknown> } }): Promise<Plan[]> {
  try {
    const v = await $.store.get('log')
    return Array.isArray(v) ? (v as Plan[]) : []
  } catch {
    return []
  }
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
    await $.tool.register({
      name: 'plan',
      description:
        'OpToken: start declares a task before changing anything (task, size, estimated cost as % of the 5-hour window, effort to execute it, delegation) and sets that effort; done closes it and reports the real cost against the estimate. Edits and commits are refused while no plan is open.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'done'] },
          task: { type: 'string' },
          size: { type: 'string', enum: [...SIZES] },
          cost: { type: 'number', description: 'Estimated cost, % of the 5-hour window' },
          effort: { type: 'string', enum: [...EFFORTS] },
          delegate: { type: 'string', description: 'What goes to which model, or "nothing"' },
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
    await update($, worked, () => false)
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

    if (e.tool === `mcp__${P}__plan`) {
      const a = e as unknown as { action?: string; task?: string; size?: string; cost?: number; effort?: string; delegate?: string }
      const open = await read($, plan)
      const five = percent(await read($, measure), 'five_hour')
      const now = await $.clock.now()
      let text: string
      if (a.action === 'start') {
        const size = SIZES.find(x => x === a.size)
        const effort = EFFORTS.find(x => x === a.effort)
        if (open) text = `A plan is still open (${planLine(open)}). Close it with done first.`
        else if (!a.task || !size || typeof a.cost !== 'number' || !effort)
          text = 'start needs task, size (S/M/L), cost (% of the 5-hour window) and effort.'
        else {
          const p: Plan = { task: a.task, size, cost: a.cost, effort, delegate: a.delegate, fiveAtStart: five, startedAt: now }
          await update($, plan, () => p)
          await update($, wanted, () => effort)
          await update($, highCalls, () => 0)
          text = `Plan open: ${planLine(p)}. Effort set to ${effort}. Tell the user this line, then work.`
        }
      } else if (a.action === 'done') {
        if (!open) text = 'No plan is open.'
        else {
          const real = five !== undefined && open.fiveAtStart !== undefined && five >= open.fiveAtStart ? five - open.fiveAtStart : undefined
          const closed: Plan = { ...open, real, endedAt: now }
          await update($, plan, () => null)
          const log = [...(await getLog($)), closed].slice(-LOG_MAX)
          await $.store.set('log', log)
          const verdict =
            real === undefined
              ? 'real cost unknown (the 5-hour window reset meanwhile)'
              : `real ${real}% against ${open.cost}% estimated${real > open.cost * 1.5 + 1 ? ': well over the estimate, estimate higher next time' : ''}`
          text = `Plan closed: ${open.task}: ${verdict}. Tell the user in one line.`
        }
      } else text = open ? `Open plan: ${planLine(open)}` : 'No plan is open.'
      return { result: text, ...(notes.length ? { context: notes } : {}) }
    }

    // Sin plan no se cambia nada: ni ediciones ni commits (los subagentes trabajan dentro del plan de quien los lanzó).
    const changes = EDIT_TOOLS.includes(e.tool) || (e.tool === 'Bash' && COMMIT.test(e.command))
    if (main && changes && !(await read($, plan)))
      return {
        deny: 'OpToken: no plan is open. Call effort with high, think the cheapest way, then call plan with start (task, size, estimated cost %, effort, delegation) and try again.',
      }
    if (main && (await read($, plan)) && HIGH.includes((await read($, wanted)) ?? DEFAULT_EFFORT)) {
      let n = 0
      await update($, highCalls, c => (n = c + 1))
      if (n === HIGH_CALLS)
        notes.push(`OpToken: ${n} steps at high effort in this plan. If the planning is done and the rest is mechanical, lower the effort now.`)
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
    if (main && changes) await update($, worked, () => true)
    if (e.tool === 'Bash') {
      let run = 0
      await update($, failRun, c => (run = res.isError === true ? c + 1 : 0))
      if (run > 0 && run % STRIKES === 0)
        notes.push(
          `OpToken: ${run} commands failed in a row (different ones). If this is trial and error, stop: call effort with high, redo the diagnosis from scratch and explain the new approach before continuing.`,
        )
    }

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
    // Trabajando solo, turnos seguidos sin cambios: despertares que gastan sin aportar.
    if (await read($, solo)) {
      let n = 0
      const did = await read($, worked)
      await update($, idle, c => (n = did ? 0 : c + 1))
      if (n === IDLE_TURNS)
        await update($, pending, p => [
          ...p,
          `OpToken: ${n} turns in a row without changes while working alone. If there is nothing to do without the user, pause your routines and watchers (scheduled tasks enabled=false) and tell the user in one line; they resume them.`,
        ])
    }
    return { ...res, text: `[optoken] ${line(m, used)}` }
  })

  on('command.run', { command: 'optoken' }, async $ => {
    const rows = (await read($, steps)).map(
      x => `${x.agent} ${x.model} esfuerzo=${x.sent ?? '—'} caché=${x.read} escrito=${x.wrote} nuevo=${x.input}`,
    )
    const open = await read($, plan)
    const log = (await getLog($)).slice(-10).map(p => `  ${planLine(p)}`)
    return {
      text: [
        status(await read($, measure), await read($, wanted)),
        `Plan abierto: ${open ? planLine(open) : 'ninguno'}`,
        'Últimas tareas (estimado → real):',
        ...(log.length ? log : ['  (ninguna todavía)']),
        'Últimos pasos:',
        ...rows,
      ].join('\n'),
    }
  })
}
