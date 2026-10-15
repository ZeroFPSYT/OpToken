import { expect, mock, test } from 'claude-code/testing'

const measure = (five: number) => ({
  context: { tokens: 50_000, window: 1_000_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-13T23:30:00.000Z' },
    { kind: 'seven_day', percentUsed: 10, resetsAt: '2026-10-15T05:00:00.000Z' },
  ],
  changed: ['rateLimits' as const],
})

test('adds its fixed directive to the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  const res = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(res.sections.map(s => s.id)).toEqual(['intro', 'optoken:directive'])
})

test('flags the same failing command on its third run', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'boom' }))
  const run = () => $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect((await run()).context).toBeUndefined()
  expect((await run()).context).toBeUndefined()
  const third = await run()
  expect(third.context?.join(' ')).toContain('trial and error')
})

test('the effort tool sets the effort and /optoken shows it', async $ => {
  const set = await $.tool.call({ tool: 'mcp__optoken__effort', effort: 'high' } as never)
  expect(String(set.result)).toContain('Effort set to high')
  const shown = await $.command.run({ command: 'optoken', args: '' } as never)
  expect(shown.text).toContain('esfuerzo high')
})

test('at 95% with the user present it only warns', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2026-10-13T20:00:00.000Z') }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  await $.session.measure(measure(96))
  const res = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(res.context?.join(' ')).toContain('they decide')
  const again = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(again.context).toBeUndefined()
})

test('the effort returns to low after an answer', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: 'mcp__optoken__effort', effort: 'high' } as never)
  await $.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok' } as never)
  const shown = await $.command.run({ command: 'optoken', args: '' } as never)
  expect(shown.text).toContain('esfuerzo low')
})

test('a failing command keeps its count across turns', async ($, on) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'boom' }))
  const run = () => $.tool.call({ tool: 'Bash', command: 'npm test' })
  await run()
  await $.turn.start({ turnId: 't2' } as never)
  await run()
  await $.turn.start({ turnId: 't3' } as never)
  expect((await run()).context?.join(' ')).toContain('trial and error')
})

test('at 95% working alone it stops and resumes as the settings say', async ($, on) => {
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2026-10-13T20:00:00.000Z') }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  await $.tool.call({ tool: 'mcp__optoken__optoken', action: 'settings_set', resume: 'always' } as never)
  const start = await $.tool.call({ tool: 'mcp__optoken__optoken', action: 'solo_start' } as never)
  expect(String(start.result)).toContain('Resume setting: always')
  await $.session.measure(measure(96))
  const res = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(res.context?.join(' ')).toContain('plus 10 minutes')
})

test('settings are saved and read back', async ($, on) => {
  mock.store(on)
  await $.tool.call({ tool: 'mcp__optoken__optoken', action: 'settings_set', weekly: true, project: 'me/app', days: '1' } as never)
  const got = await $.tool.call({ tool: 'mcp__optoken__optoken', action: 'settings_get' } as never)
  expect(String(got.result)).toContain('"project":"me/app"')
  expect(String(got.result)).toContain('"resume":"ask"')
})

test('typing OpToken opens the settings menu', async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }) as never)
  const res = await $.prompt.submit({ text: 'OpToken' } as never)
  expect(JSON.stringify(res)).toContain('settings menu')
})

test('edits and commits are refused while no plan is open', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  const edit = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(edit.deny).toContain('no plan is open')
  const commit = await $.tool.call({ tool: 'Bash', command: 'git -C repo commit -m x' })
  expect(commit.deny).toContain('no plan is open')
  const ls = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(ls.deny).toBeUndefined()
})

test('a plan opens, sets its effort, lets edits through and measures the real cost', async ($, on) => {
  mock.store(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2026-10-13T20:00:00.000Z') }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  await $.session.measure(measure(10))
  const start = await $.tool.call({ tool: 'mcp__optoken__plan', action: 'start', task: 'botón', size: 'S', cost: 2, effort: 'medium', delegate: 'nada' } as never)
  expect(String(start.result)).toContain('Effort set to medium')
  const edit = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(edit.deny).toBeUndefined()
  await $.session.measure(measure(16))
  const done = await $.tool.call({ tool: 'mcp__optoken__plan', action: 'done' } as never)
  expect(String(done.result)).toContain('real 6% against 2% estimated: well over')
  const after = await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  expect(after.deny).toContain('no plan is open')
  const shown = await $.command.run({ command: 'optoken', args: '' } as never)
  expect(shown.text).toContain('estimado 2% → real 6%')
})

test('different commands failing in a row are flagged too', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true, text: 'boom' }))
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm run e2e' })
  const third = await $.tool.call({ tool: 'Bash', command: 'node x.js' })
  expect(third.context?.join(' ')).toContain('failed in a row')
})

test('working alone, turns without changes suggest pausing the routines', async ($, on) => {
  mock.store(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }) as never)
  await $.tool.call({ tool: 'mcp__optoken__optoken', action: 'solo_start' } as never)
  for (const id of ['a', 'b', 'c']) {
    await $.turn.start({ turnId: id } as never)
    await $.turn.complete({ turnId: id, reason: 'answer', answer: 'nada' } as never)
  }
  const res = await $.prompt.submit({ text: 'despertador' } as never)
  expect(JSON.stringify(res)).toContain('pause your routines')
})
