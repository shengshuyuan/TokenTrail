const MAX_FILTER_VALUES = 50
const MAX_FILTER_VALUE_LENGTH = 200

export class InvalidQueryParameterError extends Error {}

export function parseFilterList(value: string | null, name: string): string[] | undefined {
  if (!value) return undefined

  const values = Array.from(new Set(
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  ))

  if (values.length > MAX_FILTER_VALUES) {
    throw new InvalidQueryParameterError(
      `${name} accepts at most ${MAX_FILTER_VALUES} values`
    )
  }

  if (values.some(item => item.length > MAX_FILTER_VALUE_LENGTH)) {
    throw new InvalidQueryParameterError(
      `${name} values must be at most ${MAX_FILTER_VALUE_LENGTH} characters`
    )
  }

  return values.length > 0 ? values : undefined
}

export function parseBoundedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
