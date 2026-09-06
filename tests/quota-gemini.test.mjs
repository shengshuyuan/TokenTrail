import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  credsLookLoggedIn,
  readAntigravityCliSession,
  parseAgyUsageTsv,
  parseAgyCreditsTsv,
  parseUserQuotaSummary,
  refreshAntigravityToken,
  looksLikeAuthFailure,
  fetchQuota,
} from '../src/lib/quotas/providers/gemini.js'
import { runAdapter } from '../src/lib/quotas/refresh.js'
import { resolveCliBinary } from '../src/lib/quotas/cli-login.js'
import { createFakeFs } from './helpers/quota-mock.mjs'

const HOME = '/home/test'
const NOW = () => Date.parse('2026-09-01T12:00:00.000Z')
const AGY_BIN = `${HOME}/.local/bin/agy`

const USAGE_TSV = [
  'Gemini Models\tWeekly Limit Remaining\t97%\t2026-09-07T08:45:58Z',
  'Gemini Models\tFive Hour Limit Remaining\t99%\t2026-09-02T12:43:47Z',
  'Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-09-09T07:47:26Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-02T12:47:26Z',
].join('\n')

const CREDITS_TSV = ['Remaining credits\t0', 'Upgrade\thttps://antigravity.google/g1-upgrade'].join('\n')

function loggedInFs(extra = {}) {
  return createFakeFs({
    [`${HOME}/.gemini/antigravity-cli/antigravity-oauth-token`]: JSON.stringify({
      token: {
        access_token: 'ya29.fresh',
        refresh_token: '1//refresh',
        expiry: '2026-09-01T18:00:00+08:00',
        token_type: 'Bearer',
      },
      auth_method: 'consumer',
    }),
    [AGY_BIN]: '#!/bin/sh',
    ...extra,
  })
}

function execFileFor(outputs) {
  return async (bin, args) => {
    assert.equal(bin, AGY_BIN)
    const slash = args[args.indexOf('-p') + 1]
    const stdout = outputs[slash]
    if (stdout == null) throw new Error(`unexpected slash command ${slash}`)
    if (typeof stdout === 'function') return stdout()
    if (stdout && typeof stdout === 'object' && 'stdout' in stdout) return stdout
    return { stdout, stderr: '' }
  }
}

describe('Gemini quota via Antigravity CLI', () => {
  it('parses agy /usage TSV remaining percents into usedPercent windows', () => {
    const { windows, hasUnreadable } = parseAgyUsageTsv(USAGE_TSV)
    assert.equal(hasUnreadable, false)
    assert.equal(windows.length, 4)
    assert.equal(windows[0].id, 'gemini-models-week')
    assert.equal(windows[0].label, 'Gemini Models · week')
    assert.equal(windows[0].usedPercent, 3)
    assert.equal(windows[0].windowMinutes, 10080)
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-07T08:45:58Z'))
    assert.equal(windows[1].id, 'gemini-models-5h')
    assert.equal(windows[1].usedPercent, 1)
    assert.equal(windows[1].windowMinutes, 300)
    assert.equal(windows[2].usedPercent, 0)
    assert.equal(windows[3].usedPercent, 0)
  })

  it('marks unreadable usage rows instead of inventing numbers', () => {
    const { windows, hasUnreadable } = parseAgyUsageTsv([
      'Gemini Models\tWeekly Limit Remaining\t97%\t2026-09-07T08:45:58Z',
      'broken-line-without-tabs',
      'Gemini Models\tFive Hour Limit Remaining\tnot-a-percent\t2026-09-02T12:43:47Z',
    ].join('\n'))
    assert.equal(windows.length, 1)
    assert.equal(windows[0].usedPercent, 3)
    assert.equal(hasUnreadable, true)
  })

  it('parses agy /credits remaining balance and ignores upgrade links', () => {
    const wallets = parseAgyCreditsTsv(CREDITS_TSV)
    assert.equal(wallets.length, 1)
    assert.equal(wallets[0].label, 'G1 credits')
    assert.equal(wallets[0].balance, 0)
    assert.equal(wallets[0].currency, 'credit')
  })

  it('detects Antigravity login from the official token file', () => {
    assert.equal(credsLookLoggedIn({ token: { refresh_token: 'x' } }), true)
    assert.equal(credsLookLoggedIn({ token: {} }), false)
    assert.equal(credsLookLoggedIn({ refresh_token: 'gemini-cli-shape' }), false)
    assert.equal(credsLookLoggedIn(null), false)
    const session = readAntigravityCliSession(loggedInFs(), HOME)
    assert.equal(session.loggedIn, true)
    assert.equal(readAntigravityCliSession(createFakeFs({}), HOME).loggedIn, false)
  })

  it('reports not_configured when Antigravity CLI is not logged in', async () => {
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: createFakeFs({ [AGY_BIN]: '#!/bin/sh' }),
      home: HOME,
      now: NOW,
      execFileImpl: async () => {
        throw new Error('must not spawn agy')
      },
    })
    assert.equal(snap.status, 'not_configured')
  })

  it('reports not_configured when logged in but agy is missing', async () => {
    const fsMod = createFakeFs({
      [`${HOME}/.gemini/antigravity-cli/antigravity-oauth-token`]: JSON.stringify({
        token: { refresh_token: '1//refresh' },
      }),
    })
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: fsMod,
      home: HOME,
      now: NOW,
      execFileSyncImpl: () => {
        throw new Error('no PATH')
      },
      execFileImpl: async () => {
        throw new Error('must not spawn agy')
      },
    })
    assert.equal(snap.status, 'not_configured')
  })

  it('reads official agy /usage without leaking account email', async () => {
    const fsMod = loggedInFs({
      [`${HOME}/.gemini/antigravity-cli/cli.log`]: 'OAuth: authenticated successfully as testuser@gmail.com\n',
    })
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: fsMod,
      home: HOME,
      now: NOW,
      execFileImpl: execFileFor({ '/usage': USAGE_TSV }),
    })
    assert.equal(snap.status, 'healthy')
    assert.equal(snap.source, 'local_cli')
    assert.equal(snap.planLabel, 'Antigravity')
    assert.equal(snap.windows.length, 4)
    assert.equal(snap.windows[0].usedPercent, 3)
    assert.equal(snap.wallets.length, 0)
    const json = JSON.stringify(snap)
    assert.ok(!json.includes('testuser@gmail.com'))
    assert.ok(!json.includes('ya29'))
    assert.ok(!json.includes('1//refresh'))
  })

  it('maps silent auth failure to auth_error', async () => {
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      execFileImpl: execFileFor({
        '/usage': { stdout: '', stderr: 'Print mode: silent auth failed' },
      }),
    })
    assert.equal(snap.status, 'auth_error')
  })

  it('maps unexpected usage output to unsupported_version', async () => {
    const snap = await runAdapter('gemini', fetchQuota, {
      fs: loggedInFs(),
      home: HOME,
      now: NOW,
      execFileImpl: execFileFor({
        '/usage': 'totally-new-shape without tabs',
      }),
    })
    assert.equal(snap.status, 'unsupported_version')
    assert.equal(snap.windows.length, 0)
  })

  it('finds agy at ~/.local/bin/agy', () => {
    const fsMod = createFakeFs({ [AGY_BIN]: '#!/bin/sh' })
    assert.equal(
      resolveCliBinary('agy', { home: HOME, fs: fsMod, execFileSyncImpl: () => { throw new Error('no PATH') } }),
      AGY_BIN,
    )
    assert.equal(
      resolveCliBinary('agy', { home: HOME, fs: createFakeFs({}), execFileSyncImpl: () => { throw new Error('no PATH') } }),
      null,
    )
  })

  it('parses official CloudCode retrieveUserQuotaSummary JSON correctly', () => {
    const sample = {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              resetTime: '2026-09-11T17:12:43Z',
              remainingFraction: 0.865,
            },
            {
              bucketId: 'gemini-5h',
              displayName: 'Five Hour Limit Remaining',
              window: '5h',
              resetTime: '2026-09-06T06:28:42Z',
              remainingFraction: 0.80,
            },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              resetTime: '2026-09-13T01:41:15Z',
              remainingFraction: 1.0,
            },
          ],
        },
      ],
    }
    const { windows, hasUnreadable } = parseUserQuotaSummary(sample)
    assert.equal(hasUnreadable, false)
    assert.equal(windows.length, 3)
    assert.equal(windows[0].id, 'gemini-models-week')
    assert.equal(windows[0].label, 'Gemini Models · week')
    assert.equal(windows[0].usedPercent, 13.5)
    assert.equal(windows[0].windowMinutes, 10080)
    assert.equal(windows[0].resetsAt, Date.parse('2026-09-11T17:12:43Z'))

    assert.equal(windows[1].id, 'gemini-models-5h')
    assert.equal(windows[1].usedPercent, 20.0)
    assert.equal(windows[1].windowMinutes, 300)

    assert.equal(windows[2].id, 'claude-and-gpt-models-week')
    assert.equal(windows[2].usedPercent, 0)
  })

  it('refreshAntigravityToken proactively refreshes token and writes back to disk', async () => {
    let written = null
    const fsMod = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({
        token: {
          access_token: 'old-access-token',
          refresh_token: '1//refresh-token',
          expiry: '2026-09-01T10:00:00.000Z',
          client_id: 'test-client-id.apps.googleusercontent.com',
          client_secret: 'test-client-secret',
        },
      }),
      writeFileSync: (p, content) => {
        written = JSON.parse(content)
      },
    }

    const fakeFetch = async (url, opts) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      assert.ok(opts.body.includes('refresh_token=1%2F%2Frefresh-token'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'new-fresh-access-token',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      }
    }

    const result = await refreshAntigravityToken({
      fs: fsMod,
      home: HOME,
      now: NOW,
      fetchImpl: fakeFetch,
    })

    assert.equal(result.ok, true)
    assert.equal(result.access_token, 'new-fresh-access-token')
    assert.equal(result.refreshed, true)
    assert.ok(written != null)
    assert.equal(written.token.access_token, 'new-fresh-access-token')
  })

  it('refreshAntigravityToken does not call Google without a local OAuth client', async () => {
    let fetchCalled = false
    const fsMod = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({
        token: {
          access_token: 'old-access-token',
          refresh_token: '1//refresh-token',
          expiry: '2026-09-01T10:00:00.000Z',
        },
      }),
    }
    const result = await refreshAntigravityToken({
      fs: fsMod,
      home: HOME,
      now: NOW,
      fetchImpl: async () => {
        fetchCalled = true
        throw new Error('must not call Google OAuth without a local client')
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.access_token, 'old-access-token')
    assert.equal(result.reason, 'no_oauth_client')
    assert.equal(fetchCalled, false)
  })

  it('refreshAntigravityToken skips network if token is still valid for > 5 minutes', async () => {
    let fetchCalled = false
    const fsMod = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({
        token: {
          access_token: 'still-valid-token',
          refresh_token: '1//refresh-token',
          expiry: '2026-09-01T13:00:00.000Z', // 1 hour after NOW (12:00:00Z)
        },
      }),
    }

    const fakeFetch = async () => {
      fetchCalled = true
    }

    const result = await refreshAntigravityToken({
      fs: fsMod,
      home: HOME,
      now: NOW,
      fetchImpl: fakeFetch,
    })

    assert.equal(result.ok, true)
    assert.equal(result.access_token, 'still-valid-token')
    assert.equal(result.fresh, true)
    assert.equal(fetchCalled, false)
  })

  it('looksLikeAuthFailure does not falsely flag startup silent auth log as failure', () => {
    const startupLog = 'ERROR: logging before google.Init: I0906 09:38:33.223215 1 printmode.go:364] Print mode: not authenticated, trying silent auth\n'
    assert.equal(looksLikeAuthFailure(startupLog, ''), false)
    assert.equal(looksLikeAuthFailure('Print mode: silent auth failed', ''), true)
    assert.equal(looksLikeAuthFailure('', 'Gemini Models\tWeekly Limit Remaining\t87%\t2026-09-11T17:12:43Z'), false)
  })
})
