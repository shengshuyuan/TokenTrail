const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function hostnameFromHeader(value: string | null): string | null {
  if (!value) return null

  try {
    return new URL(`http://${value}`).hostname
  } catch {
    return null
  }
}

/**
 * Protect local state-changing routes from cross-site browser requests.
 *
 * Requests without Origin remain available to CLI tools. Remote hosting must be
 * explicitly enabled because TokenTrail has no account authentication layer.
 *
 * Uses the standard Request/Response types (NextRequest extends Request, so
 * Next route handlers can pass their request unchanged) to keep this module
 * importable outside the Next runtime, e.g. by plain node --test.
 */
export function rejectUnsafeLocalMutation(request: Request): Response | null {
  if (process.env.TOKENTRAIL_ALLOW_REMOTE === '1') return null

  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return jsonResponse({ success: false, error: 'Cross-site requests are not allowed' }, 403)
  }

  const origin = request.headers.get('origin')
  if (!origin) return null

  let originHostname: string
  try {
    originHostname = new URL(origin).hostname
  } catch {
    return jsonResponse({ success: false, error: 'Invalid request origin' }, 403)
  }

  const requestHostname = hostnameFromHeader(request.headers.get('host'))
  if (
    requestHostname
    && LOCAL_HOSTNAMES.has(requestHostname)
    && LOCAL_HOSTNAMES.has(originHostname)
  ) {
    return null
  }

  return jsonResponse(
    {
      success: false,
      error: 'TokenTrail mutations are local-only. Set TOKENTRAIL_ALLOW_REMOTE=1 only in a trusted network.',
    },
    403
  )
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
