/**
 * Test-only ESM loader: resolves extensionless relative imports to `.ts`
 * files, so tests can import real src/lib modules (which follow the webpack
 * convention of extensionless relative imports) under plain node --test with
 * native type stripping. Production code is untouched.
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) {
    try {
      return await next(`${specifier}.ts`, context)
    } catch {
      // fall through: not a .ts sibling (e.g. ./foo.json handled below)
    }
  }
  return next(specifier, context)
}
