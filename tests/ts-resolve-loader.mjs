/**
 * Test-only ESM loader: resolves extensionless relative imports to `.ts`
 * files, so tests can import real src/lib modules (which follow the webpack
 * convention of extensionless relative imports) under plain node --test with
 * native type stripping. Also resolves the `@/` alias and `next/server`.
 * Production code is untouched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function aliasFile(specifier) {
  if (!specifier.startsWith('@/')) return null
  const base = path.join(root, 'src', specifier.slice(2))
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts')]
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

export async function resolve(specifier, context, next) {
  if (specifier === 'next/server') {
    return next('next/server.js', context)
  }
  const aliased = aliasFile(specifier)
  if (aliased) return next(pathToFileURL(aliased).href, context)
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // fall through: not a .ts sibling (e.g. ./foo.json handled below)
    }
  }
  return next(specifier, context)
}
