/* sync-identity.mjs — vendors the podeley identity kit into this repo.
   Zero dependencies. Copy this file to tools/sync-identity.mjs in each site.

   The kit lives in the PUBLIC repo podeley/identity precisely so that private
   repos can pull it over plain HTTPS with no token. Files are vendored and
   committed, so a build never depends on the network.

     node tools/sync-identity.mjs            # pull and write
     node tools/sync-identity.mjs --check    # fail if out of date (for CI)
     node tools/sync-identity.mjs --profile=app

   Profile comes from identity.json ({"profile":"demo"}) or --profile:
     demo       one-page demo on the kit build   → styles + demo.css + build + layout + fonts
     portfolio  podeley.ar itself                → styles + build + layout + fonts
     app        a Vite/React app keeping its own shell → styles + fonts only
*/

import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const REPO = 'podeley/identity'

const FONTS = [
  'ibm-plex-mono-400.woff2',
  'ibm-plex-mono-500.woff2',
  'ibm-plex-sans-400.woff2',
  'space-grotesk-500.woff2',
]

const PROFILES = {
  demo: { styles: ['tokens.css', 'chrome.css', 'demo.css'], into: 'src/styles', fonts: 'static/fonts', shell: true },
  portfolio: { styles: ['tokens.css', 'chrome.css'], into: 'src/styles', fonts: 'static/fonts', shell: true },
  /* A Vite/React app has its own shell and its own layout; pulling chrome.css
     would fight it (body background, .wrap, masthead). Apps take the identity
     that actually matters — type and colour — and build their chrome from it. */
  app: { styles: ['tokens.css'], into: 'src/styles', fonts: 'src/fonts', shell: false },
  /* Los sitios de caso siguen siendo MkDocs Material: un solo extra.css que
     hace de puente con el tema y trae los tokens inline (Material carga su CSS
     antes, así que separarlo en capas no ayuda acá). */
  mkdocs: { styles: ['mkdocs/extra.css'], into: 'docs/stylesheets', fonts: 'docs/fonts', shell: false },
}

const args = process.argv.slice(2)
const check = args.includes('--check')
const flag = args.find((a) => a.startsWith('--profile='))?.split('=')[1]

let cfg = {}
try {
  cfg = JSON.parse(await readFile('identity.json', 'utf8'))
} catch {
  /* no identity.json — --profile must then be given */
}
const profile = flag ?? cfg.profile
if (!PROFILES[profile]) {
  console.error(
    `Unknown profile ${JSON.stringify(profile)}. Set {"profile":"demo"} in identity.json ` +
      `or pass --profile=<${Object.keys(PROFILES).join('|')}>.`,
  )
  process.exit(2)
}
const spec = PROFILES[profile]

/* what → where */
const plan = [
  ...spec.styles.map((f) => [f, `${spec.into}/${f.split('/').pop()}`]),
  ...FONTS.map((f) => [`fonts/${f}`, `${spec.fonts}/${f}`]),
]
if (spec.shell) plan.push(['build.mjs', 'build.mjs'], ['layout.html', 'src/layout.html'])

/* raw.githubusercontent serves branch URLs from a CDN that caches for minutes,
   and a cache-busting query param does NOT reliably beat it (measured: x-cache
   HIT on a unique query). So resolve the ref to a commit SHA once and fetch by
   SHA: a new commit is a new URL, always fresh — and the vendoring becomes
   reproducible. Pin "ref" in identity.json to freeze a site on a kit version. */
const ref = process.env.IDENTITY_REF || cfg.ref || 'main'

const sha = /^[0-9a-f]{40}$/.test(ref)
  ? ref
  : await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, {
      headers: { Accept: 'application/vnd.github.sha' },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`cannot resolve ${REPO}@${ref}: HTTP ${r.status}`)
      return (await r.text()).trim()
    })

const BASE = `https://raw.githubusercontent.com/${REPO}/${sha}/kit`

async function pull(remote) {
  const res = await fetch(`${BASE}/${remote}`)
  if (!res.ok) throw new Error(`${remote}: HTTP ${res.status} from ${BASE}`)
  return Buffer.from(await res.arrayBuffer())
}

const changed = []
const stale = []

for (const [remote, local] of plan) {
  const next = await pull(remote)
  let current = null
  try {
    if (await access(local).then(() => true, () => false)) current = await readFile(local)
  } catch {
    /* treat as missing */
  }
  const same = current && current.equals(next)
  if (same) continue

  if (check) {
    stale.push(local)
    continue
  }
  await mkdir(dirname(local), { recursive: true })
  await writeFile(local, next)
  changed.push(`${current ? 'updated' : 'added  '}  ${local}`)
}

const at = `${REPO}@${sha.slice(0, 7)}${ref === sha ? ' (pinned)' : ` (${ref})`}`

if (check) {
  if (stale.length) {
    console.error(`identity kit out of date vs ${at} (${stale.length}):\n  ${stale.join('\n  ')}`)
    console.error('\nrun: node tools/sync-identity.mjs')
    process.exit(1)
  }
  console.log(`identity kit up to date · profile ${profile} · ${at}`)
} else {
  console.log(changed.length ? changed.join('\n') : 'already up to date')
  console.log(`\nprofile: ${profile} · ${plan.length} files · ${at}`)
  if (changed.length) console.log('remember to commit the vendored files')
}
