import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { changedSymbols, findDeclaration, parseLines, parseLook, parseReferences, parseReview, repoPath, wordDiff, wordDiffs } from './register'

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1..2 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,2 +1,2 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  'diff --git a/README.md b/README.md',
  'index 3..4 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # App',
  '+More docs',
  '',
].join('\n')

const PANE = {
  title: 'PR review',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const OUTPUT: Record<string, string> = {
  'gh pr view': JSON.stringify({ number: 42, title: 'Bump b', url: 'u', baseRefName: 'main', headRefName: 'feat', headRefOid: 'sha1' }),
  'git merge-base': 'abc123\n',
  'git diff --numstat': '1\t1\tsrc/app.ts\n1\t0\tREADME.md\n',
  'git diff abc123': DIFF,
  'git rev-parse HEAD': 'sha1\n',
  'gh api': JSON.stringify({ html_url: 'https://github.com/o/r/pull/42#discussion_r1' }),
}

describe('pr-live-review', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`lists files with summaries and opens a diff on ${surface}`, async ($, on) => {
      const clock = mock.clock(on)
      const calls: string[][] = []
      on('process.run', async (_, e) => {
        calls.push([...e.argv])
        const line = e.argv.join(' ')
        const hit = Object.keys(OUTPUT).find(k => line.startsWith(k))
        return { value: { exitCode: 0, stdout: hit ? OUTPUT[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      })
      const models: string[] = []
      on('model.complete', async (_, e) => (models.push(e.model), {
        value: {
          isAnswered: true,
          text: e.prompt.includes('README.md')
            ? '{"summary": "Adds docs.", "findings": []}'
            : '```json\n{"summary": "Changes b to 3.", "findings": [{"severity": "medium", "line": "2", "message": "b changes without a test."}]}\n```',
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      }))
      on('ui.open', async () => ({ value: { isPlaced: true } }))
      on('ui.close', async () => ({ value: undefined }))
      on('prompt.fill', async () => ({ isFilled: true }))
      const sent: string[] = []
      on('prompt.submit', async (_, e) => {
        sent.push(e.text)
        return { text: e.text }
      })
      on('ui.scroll', async () => ({}))

      await $.command.run({
        command: 'pr-live-review',
        args: '/repo',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: true, columns: 160 },
      })
      await clock.settle()

      const ui = await $.ui.mount({ plugin: 'pr-live-review', surface, component: 'Pane', requestId: 'pr-live-review', props: PANE })
      expect(await ui.find({ type: 'Text', text: /#42 Bump b/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Changes b to 3\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Adds docs\./ })).toBeDefined()

      expect(models.every(m => m === 'sonnet')).toBe(true)
      await ui.press({ key: 'file:src/app.ts' })
      expect(await ui.find({ type: 'Text', text: /1\/2 M src\/app\.ts/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\+const b = 3/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^3$/ }))?.props.backgroundColor).toBe('#1f5a30')

      await ui.press({ key: 'L:2' })
      await ui.press({ key: 'mark' })
      await ui.press({ key: 'L:3' })
      await ui.press({ key: 'comment' })
      await clock.advance(100)
      await ui.input({ key: 'draft', text: 'Why change b to 3?' })
      expect(await ui.find({ type: 'Text', text: /L2: Why change b to 3\?/ })).toBeDefined()

      expect(await ui.find({ type: 'Text', text: /b changes without a test\./ })).toBeDefined()
      await ui.press({ key: 'jump:src/app.ts#2:b changes without a test.' })
      await ui.press({ key: 'edit' })
      await clock.advance(100)
      expect(await ui.find({ key: 'draft' })).toBeDefined()
      await ui.input({ key: 'draft', text: 'Add a test for b.' })
      expect(await ui.find({ type: 'Text', text: /L2: Add a test for b\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /\(comment\)/ })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /you L2: Add a test for b\./ }))?.props.wrap).toBe('wrap')
      expect((await ui.find({ type: 'Text', text: /b changes without a test\. \(comment\)/ }))?.props.wrap).toBe('wrap')

      const notes = await ui.find({ type: 'Text', text: /you L2: Why change b to 3\?/ })
      expect(notes).toBeDefined()
      await ui.press({ key: 'L:3' })
      expect(await ui.find({ type: 'Text', text: /▶ you L2: Why change b to 3\?/ })).toBeDefined()
      await ui.press({ key: 'card-next' })
      expect(await ui.find({ type: 'Text', text: /▶ you L2: Add a test for b\./ })).toBeDefined()
      expect(await ui.find({ key: 'card-next', text: /card 2\/2/ })).toBeDefined()
      await ui.press({ key: 'edit' })
      await clock.advance(100)
      expect((await ui.find({ key: 'draft' }))?.props.value).toBe('Add a test for b.')
      await ui.input({ key: 'draft', text: 'Please add a test for b.' })
      expect(await ui.find({ type: 'Text', text: /you L2: Please add a test for b\./ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /you L2: Add a test for b\./ })).toBeUndefined()

      await ui.press({ key: 'card-prev' })
      await ui.press({ key: 'post' })
      await clock.advance(100)
      expect((await ui.find({ key: 'draft' }))?.props.value).toBe('Why change b to 3?')
      await ui.press({ key: 'cancel' })
      expect(await ui.find({ key: 'draft' })).toBeUndefined()
      expect(calls.some(a => a[0] === 'gh' && a[1] === 'api')).toBe(false)

      await ui.press({ key: 'post' })
      await clock.advance(100)
      await ui.input({ key: 'draft', text: 'Why change b to 3? It was 2 on purpose.' })
      const posts = calls.filter(a => a[0] === 'gh' && a[1] === 'api')
      expect(posts.length).toBe(1)
      const argv = posts[0]!.join('\u0000')
      expect(argv).toContain('repos/{owner}/{repo}/pulls/42/comments')
      expect(argv).toContain('-f\u0000body=Why change b to 3? It was 2 on purpose.\u0000')
      expect(argv).toContain('-f\u0000commit_id=sha1')
      expect(argv).toContain('-f\u0000path=src/app.ts')
      expect(argv).toContain('-F\u0000line=2\u0000-f\u0000side=RIGHT\u0000-F\u0000start_line=2\u0000-f\u0000start_side=LEFT')
      expect(await ui.find({ type: 'Text', text: /Why change b to 3\? It was 2 on purpose\. \(posted\)/ })).toBeDefined()
      expect(await ui.find({ key: 'draft' })).toBeUndefined()
      await ui.press({ key: 'post' })
      expect(calls.filter(a => a[0] === 'gh' && a[1] === 'api').length).toBe(1)

      await ui.press({ key: 'next' })
      expect(await ui.find({ type: 'Text', text: /2\/2 M README\.md/ })).toBeDefined()

      await ui.press({ key: 'back' })
      expect(await ui.find({ key: 'file:README.md' })).toBeDefined()

      await ui.press({ key: 'send' })
      expect(sent.length).toBe(1)
      expect(sent[0]).toContain('### src/app.ts:L')
      expect(sent[0]).not.toContain('Why change b to 3?')
      expect(sent[0]).toContain('Please add a test for b.')
      await ui.unmount()
    })
  }

  test('cycles the findings, asks about the line, shows why a post failed and cancels the draft', async ($, on) => {
    const clock = mock.clock(on)
    const calls: string[][] = []
    on('process.run', async (_, e) => {
      calls.push([...e.argv])
      const line = e.argv.join(' ')
      const stdout = line.startsWith('git rev-parse') ? 'other\n' : (OUTPUT[Object.keys(OUTPUT).find(k => line.startsWith(k)) ?? ''] ?? '')
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('model.complete', async () => ({
      value: { isAnswered: true, text: '{"summary": "Fine.", "findings": [{"severity": "high", "line": "2", "message": "Check b."}, {"severity": "low", "line": "2", "message": "Name b better."}]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    const opens: { focus?: true; closeOnEscape?: true }[] = []
    on('ui.open', async (_, e) => (opens.push({ focus: e.focus, closeOnEscape: e.closeOnEscape }), { value: { isPlaced: true } }))
    on('ui.scroll', async () => ({}))
    const fills: string[] = []
    on('prompt.fill', async (_, e) => (fills.push(e.text), { isFilled: true }))

    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: PANE })
    await ui.press({ key: 'file:src/app.ts' })
    await ui.press({ key: 'L:3' })
    await ui.press({ key: 'ask' })
    expect(fills[0]).toBe('src/app.ts L2 in PR #42:\n```\n+const b = 3\n```\n')
    expect(await ui.find({ type: 'Text', text: /▶ AI ● Check b\./ })).toBeDefined()
    await ui.press({ key: 'card-next' })
    expect(await ui.find({ type: 'Text', text: /▶ AI · Name b better\./ })).toBeDefined()
    await ui.press({ key: 'card-next' })
    expect(await ui.find({ type: 'Text', text: /▶ AI ● Check b\./ })).toBeDefined()
    await ui.press({ key: 'card-prev' })
    await ui.press({ key: 'post' })
    await clock.advance(100)
    expect((await ui.find({ key: 'draft' }))?.props.value).toBe('Name b better.')
    expect((await ui.find({ type: 'Text', text: /^Name b better\.$/ }))?.props.wrap).toBe('wrap')
    expect(opens.at(-1)?.closeOnEscape).toBe(true)
    await ui.input({ key: 'draft', text: 'Rename b.' })
    expect(calls.some(a => a[0] === 'gh' && a[1] === 'api')).toBe(false)
    expect((await ui.find({ type: 'Text', text: /Local HEAD is not the PR head/ }))?.props.color).toBe('red')
    expect((await ui.find({ key: 'draft' }))?.props.value).toBe('Rename b.')
    expect((await ui.find({ type: 'Text', text: /^Rename b\.$/ }))?.props.wrap).toBe('wrap')

    await ui.press({ key: 'cancel' })
    expect(await ui.find({ key: 'draft' })).toBeUndefined()
    expect(await ui.find({ key: 'edit' })).toBeDefined()
    expect(opens.at(-1)?.closeOnEscape).toBeUndefined()
    await ui.unmount()
  })

  test('h and l jump between comments on different lines and wrap around', async ($, on) => {
    const clock = mock.clock(on)
    on('process.run', async (_, e) => {
      const line = e.argv.join(' ')
      const hit = Object.keys(OUTPUT).find(k => line.startsWith(k))
      return { value: { exitCode: 0, stdout: hit ? OUTPUT[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('model.complete', async () => ({
      value: { isAnswered: true, text: '{"summary": "Fine.", "findings": [{"severity": "high", "line": "1", "message": "Check a."}, {"severity": "low", "line": "2", "message": "Check b."}]}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: PANE })
    await ui.press({ key: 'file:src/app.ts' })
    await ui.press({ key: 'L:0' })
    expect(await ui.find({ key: 'card-next', text: /card -\/2/ })).toBeDefined()
    await ui.press({ key: 'card-next' })
    expect(await ui.find({ type: 'Text', text: /▶ AI ● Check a\./ })).toBeDefined()
    await ui.press({ key: 'card-next' })
    expect(await ui.find({ type: 'Text', text: /▶ AI · Check b\./ })).toBeDefined()
    expect(await ui.find({ key: 'card-next', text: /card 2\/2/ })).toBeDefined()
    await ui.press({ key: 'card-next' })
    expect(await ui.find({ type: 'Text', text: /▶ AI ● Check a\./ })).toBeDefined()
    await ui.press({ key: 'card-prev' })
    expect(await ui.find({ type: 'Text', text: /▶ AI · Check b\./ })).toBeDefined()
    await ui.unmount()
  })

  test('shows the file list beside the diff in a wide pane', async ($, on) => {
    const clock = mock.clock(on)
    on('process.run', async (_, e) => {
      const line = e.argv.join(' ')
      const hit = Object.keys(OUTPUT).find(k => line.startsWith(k))
      return { value: { exitCode: 0, stdout: hit ? OUTPUT[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('model.complete', async () => ({
      value: { isAnswered: true, text: '{"summary": "Fine.", "findings": []}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('ui.scroll', async () => ({}))

    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: { ...PANE, bodyColumns: 140 } })
    await ui.press({ key: 'file:src/app.ts' })
    expect(await ui.find({ type: 'Text', text: /\+const b = 3/ })).toBeDefined()
    expect(await ui.find({ key: 'file:README.md' })).toBeDefined()
    await ui.press({ key: 'file:README.md' })
    expect(await ui.find({ type: 'Text', text: /2\/2 M README\.md/ })).toBeDefined()
    await ui.unmount()
  })
})

const LSP_DIFF = [
  'diff --git a/lib/price.js b/lib/price.js',
  '--- a/lib/price.js',
  '+++ b/lib/price.js',
  '@@ -1,3 +1,3 @@',
  '-export function totalPrice(items) {',
  '+export function totalPrice(items, voucher) {',
  '   return items.length',
  ' }',
  '',
].join('\n')

const LSP_OUTPUT: Record<string, string> = {
  'gh pr view': JSON.stringify({ number: 7, title: 'Vouchers', url: 'v', baseRefName: 'main', headRefName: 'feat', headRefOid: 'sha1' }),
  'git merge-base': 'abc123\n',
  'git diff --numstat': '1\t1\tlib/price.js\n',
  'git diff abc123': LSP_DIFF,
}

const FILES: Record<string, string> = {
  '/repo/lib/price.js': 'export function totalPrice(items, voucher) {\n  return items.length\n}\n',
  '/repo/pages/cart.js': 'import { totalPrice } from "../lib/price"\n\nconst sum = totalPrice(cart)\nshow(sum)\n',
}

describe('language server context', () => {
  test('finds names declared on changed lines and in hunk headers', () => {
    expect(changedSymbols(LSP_DIFF)).toEqual(['totalPrice'])
    expect(changedSymbols('@@ -4,2 +4,2 @@ async function loadCart(id) {\n-  a\n+  b\n')).toEqual(['loadCart'])
    expect(findDeclaration(FILES['/repo/lib/price.js']!, 'totalPrice')).toEqual({ line: 1, character: 17 })
  })

  test('parses one and many references', () => {
    expect(parseReferences('Found 1 reference:\n  pages/cart.js:3:13')).toEqual([{ path: 'pages/cart.js', line: 3, character: 13 }])
    expect(parseReferences('Found 2 references across 2 files:\n\nlib/price.js:\n  Line 1:17\n\npages/cart.js:\n  Line 3:13')).toEqual([
      { path: 'lib/price.js', line: 1, character: 17 },
      { path: 'pages/cart.js', line: 3, character: 13 },
    ])
  })

  for (const hasServer of [true, false]) {
    test(`reviews ${hasServer ? 'with' : 'without'} a language server`, async ($, on) => {
      const clock = mock.clock(on)
      on('process.run', async (_, e) => {
        const line = e.argv.join(' ')
        const hit = Object.keys(LSP_OUTPUT).find(k => line.startsWith(k))
        return { value: { exitCode: 0, stdout: hit ? LSP_OUTPUT[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      })
      on('session.cwd', async () => ({ value: '/repo' }))
      on('fs.read', async (_, e) => (e.path in FILES ? { value: FILES[e.path]! } : { deny: 'ENOENT' }))
      on('fs.stat', async (_, e) => (e.path === '/repo' || e.path in FILES ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } : { deny: 'ENOENT' }))
      const lspCalls: unknown[] = []
      on('tool.call', { tool: 'LSP' }, async (_, e) => {
        lspCalls.push(e)
        const text = hasServer ? 'Found 2 references across 2 files:\n\nlib/price.js:\n  Line 1:17\n\npages/cart.js:\n  Line 3:13' : 'Error performing findReferences: Executable not found in $PATH'
        return { result: { operation: 'findReferences', result: text, filePath: '/repo/lib/price.js' }, text, ...(hasServer ? {} : { isError: true }) }
      })
      const prompts: string[] = []
      on('model.complete', async (_, e) => (prompts.push(e.prompt), {
        value: { isAnswered: true, text: '{"summary": "Adds a voucher.", "findings": []}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      }))
      on('ui.open', async () => ({ value: { isPlaced: true } }))

      await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
      await clock.settle()

      expect(lspCalls.length).toBe(1)
      expect(prompts.length).toBe(1)
      if (hasServer) {
        expect(prompts[0]).toContain('Call sites outside the diff')
        expect(prompts[0]).toContain('used in pages/cart.js:3')
        expect(prompts[0]).toContain('>    3| const sum = totalPrice(cart)')
        expect(prompts[0]).not.toContain('used in lib/price.js:1')
      } else {
        expect(prompts[0]).not.toContain('Call sites outside the diff')
      }
    })
  }
})

describe('word diff', () => {
  test('marks only the changed words of a paired line', () => {
    expect(wordDiff('const b = 2', 'const b = 3')).toEqual([
      [{ text: 'const b = ', changed: false }, { text: '2', changed: true }],
      [{ text: 'const b = ', changed: false }, { text: '3', changed: true }],
    ])
  })

  test('skips lines that share too little', () => {
    expect(wordDiff('return items.length', 'throw new Error(message)')).toBeNull()
  })

  test('pairs removed and added runs in order', () => {
    const lines = parseLines('@@ -1,3 +1,3 @@\n-let a = 1\n-let b = 2\n+let a = 10\n+let b = 20\n same\n')
    expect([...wordDiffs(lines).keys()]).toEqual([1, 3, 2, 4])
  })
})

describe('review context', () => {
  test('gives the reviewer the repository rules, the review skill and the full file', async ($, on) => {
    const clock = mock.clock(on)
    const stdout: Record<string, string> = {
      ...OUTPUT,
      'git rev-parse --show-toplevel': '/repo\n',
      'sh -c': '/cfg\n/home',
    }
    on('process.run', async (_, e) => {
      const line = e.argv.join(' ')
      const hit = Object.keys(stdout).find(k => line.startsWith(k))
      return { value: { exitCode: 0, stdout: hit ? stdout[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const disk: Record<string, string> = {
      '/repo/CLAUDE.md': '# Rules\nNever swallow errors.\n@AGENTS.md\n@/outside/secret.md\n',
      '/outside/secret.md': 'Private key material.',
      '/repo/AGENTS.md': 'Select only the columns you need.',
      '/repo/src/CLAUDE.md': 'No barrel files in src.',
      '/cfg/skills/review-senior-engineer/SKILL.md': '---\nname: review-senior-engineer\n---\n# Review as a senior engineer\nWhy do we need to cast?',
      '/repo/src/app.ts': 'const a = 1\nconst b = 3\n',
    }
    on('fs.read', async (_, e) => (e.path in disk ? { value: disk[e.path]! } : { deny: 'ENOENT' }))
    on('fs.stat', async (_, e) => (e.path === '/repo' || e.path in disk ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } : { deny: 'ENOENT' }))
    const asks: { system: string; prompt: string }[] = []
    on('model.complete', async (_, e) => (asks.push({ system: e.system ?? '', prompt: e.prompt }), {
      value: { isAnswered: true, text: '{"summary": "Fine.", "findings": []}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))

    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()

    expect(asks.length).toBe(2)
    const app = asks.find(a => a.prompt.includes('File: src/app.ts'))!
    const readme = asks.find(a => a.prompt.includes('File: README.md'))!
    expect(app.system).toContain('Never swallow errors.')
    expect(app.system).toContain('Select only the columns you need.')
    expect(app.system).toContain('Why do we need to cast?')
    expect(app.system).not.toContain('name: review-senior-engineer')
    expect(app.system).not.toContain('Private key material.')
    expect(app.system).toBe(readme.system)
    expect(app.prompt).toContain('No barrel files in src.')
    expect(app.prompt).toContain('The full new file:')
    expect(app.prompt).toContain('const b = 3')
    expect(readme.prompt).not.toContain('No barrel files in src.')
  })
})

describe('bundled review skill', () => {
  test('uses the skill that ships with the plugin when the user has none', async ($, on) => {
    const clock = mock.clock(on)
    on('process.run', async (_, e) => {
      const line = e.argv.join(' ')
      const stdout = line.startsWith('sh -c') ? '/cfg\n/home' : line.startsWith('git rev-parse --show-toplevel') ? '/repo\n' : (OUTPUT[Object.keys(OUTPUT).find(k => line.startsWith(k)) ?? ''] ?? '')
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const reads: string[] = []
    on('fs.read', async (_, e) => {
      reads.push(e.path)
      return e.path.endsWith('/skills/review-senior-engineer/SKILL.md') && !/^\/(repo|cfg|home)\//.test(e.path)
        ? { value: '---\nname: review-senior-engineer\n---\nBundled lens.' }
        : { deny: 'ENOENT' }
    })
    on('fs.stat', async (_, e) => (e.path === '/repo' ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } : { deny: 'ENOENT' }))
    const systems: string[] = []
    on('model.complete', async (_, e) => (systems.push(e.system ?? ''), {
      value: { isAnswered: true, text: '{"summary": "Fine.", "findings": []}', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()
    const skillReads = reads.filter(r => r.endsWith('/review-senior-engineer/SKILL.md'))
    expect(skillReads.slice(0, 3)).toEqual(['/repo/.claude/skills/review-senior-engineer/SKILL.md', '/cfg/skills/review-senior-engineer/SKILL.md', '/home/.claude/skills/review-senior-engineer/SKILL.md'])
    expect(skillReads[3]).not.toContain('.claude-plugin')
    expect(systems[0]).toContain('Bundled lens.')
  })
})

describe('look before you ask', () => {
  test('parses look-ups and keeps paths inside the repository', () => {
    expect(parseLook('{"look": [{"read": "src/a.ts", "from": 10, "to": 20}, {"grep": "foo[(]", "glob": "*.ts"}, {"files": "src/**"}, {"bad": 1}]}')).toEqual([
      { read: 'src/a.ts', from: 10, to: 20 },
      { grep: 'foo[(]', glob: '*.ts' },
      { files: 'src/**' },
    ])
    expect(parseLook('{"summary": "Fine.", "findings": []}')).toBeNull()
    expect(parseLook('{"look": [{"grep": "a", "glob": "x/*"}]}\n```\n\n{"look": [{"grep": "a", "glob": "x/**"}]}')).toEqual([
      { grep: 'a', glob: 'x/*' },
      { grep: 'a', glob: 'x/**' },
    ])
    expect(parseLook('```json\n{"look": [{"read": "a {b} \\"c\\".ts"}]}\n```')).toEqual([{ read: 'a {b} "c".ts' }])
    expect(parseReview('Thinking.\n{"look": []}\n{"summary": "Fine.", "findings": [{"severity": "high", "line": "2", "message": "Bad."}]}', 'a.ts').findings.length).toBe(1)
    expect(parseLook('not json')).toBeNull()
    expect(repoPath('/repo', 'src/a.ts')).toBe('/repo/src/a.ts')
    expect(repoPath('/repo', '/repo/src/a.ts')).toBe('/repo/src/a.ts')
    expect(repoPath('/repo', '../etc/passwd')).toBeNull()
    expect(repoPath('/repo', '/etc/passwd')).toBeNull()
  })

  const setup = (on: On, replies: (prompt: string, n: number) => string) => {
    const clock = mock.clock(on)
    const runs: string[] = []
    const stdout: Record<string, string> = {
      ...OUTPUT,
      'git rev-parse --show-toplevel': '/repo\n',
      'git grep': 'server/api/b.ts:7:  validateB(input)\n',
      'git ls-files -- none/**': '',
      'git ls-files': 'server/api/b.ts\nserver/helpers/b.ts\n',
    }
    on('process.run', async (_, e) => {
      const line = e.argv.join(' ')
      runs.push(line)
      if (line.startsWith('git ls-files --error-unmatch')) {
        const isTracked = !line.endsWith('.env')
        return { value: { exitCode: isTracked ? 0 : 1, stdout: '', stderr: isTracked ? '' : 'error: pathspec did not match', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      const hit = Object.keys(stdout).find(k => line.startsWith(k))
      return { value: { exitCode: 0, stdout: hit ? stdout[hit]! : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    const disk: Record<string, string> = {
      '/repo/src/app.ts': 'const a = 1\nconst b = 3\n',
      '/repo/.env': 'API_KEY=secret',
      '/repo/server/api/b.ts': Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'),
    }
    on('fs.read', async (_, e) => (e.path in disk ? { value: disk[e.path]! } : { deny: 'ENOENT' }))
    on('fs.stat', async (_, e) =>
      e.path === '/repo/link.ts'
        ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: true, realPath: '/outside/secret.md' } }
        : e.path === '/repo/notes.txt'
          ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: true, realPath: '/repo/.env' } }
        : e.path === '/repo' || e.path in disk
          ? { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
          : { deny: 'ENOENT' },
    )
    const prompts: string[] = []
    on('model.complete', async (_, e) => {
      prompts.push(e.prompt)
      const text = e.prompt.includes('File: README.md') ? '{"summary": "Docs.", "findings": []}' : replies(e.prompt, prompts.filter(p => p.includes('File: src/app.ts')).length)
      return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
    })
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    return { clock, runs, prompts }
  }

  test('runs the look-ups and gives the results back before the findings', async ($, on) => {
    const { clock, runs, prompts } = setup(on, (_, n) =>
      n === 1
        ? '{"look": [{"read": "server/api/b.ts", "from": 6, "to": 8}, {"grep": "validateB", "glob": "*.ts"}, {"files": "server/**/b.ts"}, {"read": "../secrets.yaml"}, {"read": "link.ts"}]}'
        : n === 2
          ? '{"look": [{"read": ".env"}, {"files": "none/**"}, {"read": "notes.txt"}]}'
          : '{"summary": "Changes b.", "findings": [{"severity": "high", "line": "2", "message": "server/api/b.ts:7 validates b before it reaches here, but not for 3."}]}',
    )
    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()

    const app = prompts.filter(p => p.includes('File: src/app.ts'))
    expect(app.length).toBe(3)
    expect(app[0]).not.toContain('Round 1')
    expect(app[1]).toContain('Round 1, you asked:')
    expect(app[1]).toContain('read server/api/b.ts lines 6-8 of 10:\n    6| line 6\n    7| line 7\n    8| line 8')
    expect(app[1]).toContain('grep "validateB" in *.ts: 1 line:\nserver/api/b.ts:7:  validateB(input)')
    expect(app[1]).toContain('files server/**/b.ts: 2 lines:')
    expect(app[1]).toContain('read ../secrets.yaml: refused')
    expect(app[2]).toContain('files none/**: no match.')
    expect(app[1]).toContain('read link.ts: no such file inside the repository.')
    expect(app[2]).toContain('read .env: refused, git does not track this file.')
    expect(app[2]).toContain('read notes.txt: refused, git does not track this file.')
    expect(app[2]).not.toContain('API_KEY=secret')
    expect(runs).toContain('git ls-files --error-unmatch -- :(literal)server/api/b.ts')
    expect(runs).toContain('git grep -n -I -E -e validateB -- *.ts')
    expect(runs).toContain('git ls-files -- server/**/b.ts')

    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: PANE })
    await ui.press({ key: 'file:src/app.ts' })
    expect(await ui.find({ type: 'Text', text: /⌕8/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /validates b before it reaches here/ })).toBeDefined()
    await ui.unmount()
  })

  test('asks again when a reply has no JSON', async ($, on) => {
    const { clock, prompts } = setup(on, (_, n) => (n === 1 ? 'Let me check the callers first.' : '{"summary": "Fine.", "findings": []}'))
    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()
    const app = prompts.filter(p => p.includes('File: src/app.ts'))
    expect(app.length).toBe(2)
    expect(app[1]).toContain('your reply had no JSON object that could be read')
    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: PANE })
    await ui.press({ key: 'file:src/app.ts' })
    expect(await ui.find({ type: 'Text', text: /^Fine\.$/ })).toBeDefined()
    await ui.unmount()
  })

  test('stops after the last round and asks for the findings', async ($, on) => {
    const { clock, prompts } = setup(on, prompt =>
      prompt.includes('No more look-ups are possible') ? '{"look": [{"grep": "still b"}]}' : '{"look": [{"grep": "b"}]}',
    )
    await $.command.run({ command: 'pr-live-review', args: '/repo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
    await clock.settle()

    const app = prompts.filter(p => p.includes('File: src/app.ts'))
    expect(app.length).toBe(8)
    expect(app[7]).toContain('Round 7, you asked:')
    expect(app[7]).toContain('No more look-ups are possible')
    const ui = await $.ui.mount({ plugin: 'pr-live-review', surface: 'terminal', component: 'Pane', requestId: 'pr-live-review', props: PANE })
    expect(await ui.find({ type: 'Text', text: /the reviewer did not stop looking/ })).toBeDefined()
    await ui.unmount()
  })
})
