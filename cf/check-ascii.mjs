#!/usr/bin/env node
/**
 * Enforce the repository convention that scripts/tests stay pure ASCII.
 *
 * Why this exists (see AGENTS.md section 1): on this Windows box, writing
 * non-ASCII content through PowerShell redirection encodes it with the system
 * code page (GBK/936). That mangles Chinese text, and the mangling can eat or
 * add quote characters, turning the file into a hard SyntaxError. The failure
 * looks like a logic bug because the broken line just shows as mojibake.
 *
 * Rather than relying on people remembering, this script fails the check so the
 * problem is caught before it reaches a commit.
 *
 * Scope: script/test/tool files only. Docs (*.md), Vue components, app source
 * and SQL are intentionally exempt -- those are maintained by UTF-8-safe
 * tooling and legitimately contain Chinese.
 *
 * Usage:
 *   node cf/check-ascii.mjs            # check the default scope
 *   node cf/check-ascii.mjs --list     # also list every file examined
 *
 * Exit code: 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/**
 * Directories to scan.
 *
 * Scope is deliberately NARROW: this guards *scripts / tests / tools*, not
 * application source. cf/lib/*.js and cf/routes/*.js are production code
 * maintained by UTF-8-safe tooling and legitimately contain Chinese comments;
 * including them would drown the signal in false positives (see AGENTS.md 1).
 */
const TARGETS = [
  // cf/: only top-level entry scripts, tests and generated SQL helpers.
  // Subdirectories (lib/ = app code, routes/ = app code, migrations/ = SQL)
  // are excluded by skipDirs below.
  { dir: 'cf', exts: ['.mjs'], skipDirs: ['lib', 'routes', 'migrations'] },
  { dir: 'tools', exts: ['.bat', '.ps1', '.cmd'] },
]

/**
 * Files that predate this convention and are deliberately NOT rewritten.
 * Rewriting working scripts purely for cosmetics adds churn and risk with no
 * behavioural benefit. New files must comply; the guard below also reports
 * these as warnings so the backlog stays visible.
 */
const GRANDFATHERED = new Set([
  'cf/smoke-test.mjs',
  'cf/verify-api-coverage.mjs',
  'cf/verify-cost-permission.mjs',
  'cf/verify-d1-cost.mjs',
  'cf/verify-healthfix.mjs',
  'cf/verify-mobile-api.mjs',
  'cf/verify-mobile-boss.mjs',
  'cf/verify-mobile-redirect.mjs',
  'cf/verify-routes.mjs',
  'cf/verify-upload.mjs',
])

const showList = process.argv.includes('--list')

function walk(dir, exts, skipDirs, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (skipDirs.includes(e.name) || e.name === 'node_modules') continue
      walk(full, exts, skipDirs, out)
    } else if (exts.includes(extname(e.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

/**
 * Find the first non-ASCII byte and describe it for a useful error message.
 *
 * Operating on BYTES (not decoded text) is deliberate: a file may already be
 * encoded as GBK, in which case decoding as UTF-8 would throw or produce
 * replacement characters, and the line number would be misleading.
 */
function findNonAscii(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > 0x7f) {
      // count lines up to this byte
      let line = 1
      for (let j = 0; j < i; j++) if (buf[j] === 0x0a) line++
      // show a short hex context
      const start = Math.max(0, i - 4)
      const ctx = []
      for (let j = start; j < Math.min(buf.length, i + 6); j++) {
        ctx.push(buf[j].toString(16).padStart(2, '0'))
      }
      return { byte: i, line, hex: buf[i].toString(16).padStart(2, '0'), ctx: ctx.join(' ') }
    }
  }
  return null
}

const violations = []
const grandfatheredHit = []
const checked = []

for (const t of TARGETS) {
  const dir = join(ROOT, t.dir)
  for (const file of walk(dir, t.exts, t.skipDirs || [])) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    const buf = readFileSync(file)
    checked.push(rel)

    const bad = findNonAscii(buf)
    if (!bad) continue

    if (GRANDFATHERED.has(rel)) {
      grandfatheredHit.push({ rel, line: bad.line })
    } else {
      violations.push({ rel, ...bad })
    }
  }
}

if (showList) {
  console.log(`Examined ${checked.length} file(s):`)
  for (const f of checked) console.log(`  ${f}`)
  console.log('')
}

console.log('='.repeat(60))
console.log('  ASCII check for scripts/tests/tools (AGENTS.md section 1)')
console.log('='.repeat(60))

if (grandfatheredHit.length) {
  console.log(`\n  Pre-existing (allowed, not enforced): ${grandfatheredHit.length}`)
  for (const g of grandfatheredHit) {
    console.log(`    ${g.rel}  (first non-ASCII at line ${g.line})`)
  }
}

if (violations.length === 0) {
  console.log(`\n  PASS - no violations in ${checked.length} checked file(s).`)
  console.log('')
  process.exit(0)
}

console.log(`\n  FAIL - ${violations.length} file(s) contain non-ASCII:`)
for (const v of violations) {
  console.log(`\n    ${v.rel}`)
  console.log(`      first non-ASCII byte at line ${v.line} (0x${v.hex})`)
  console.log(`      context: ${v.ctx}`)
}
console.log('\n  Fix: rewrite the file with pure ASCII, or express any required')
console.log('  Chinese via Unicode escapes, e.g. \'\\u5b89\\u88c5\'.')
console.log('  Do NOT write non-ASCII through PowerShell redirection.')
console.log('')
process.exit(1)
