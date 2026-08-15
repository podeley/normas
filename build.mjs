/* build.mjs — podeley identity kit. Zero dependencies, ships no runtime JS.
   Vendored into each site by tools/sync-identity.mjs; do not edit the copy,
   edit podeley/identity and re-sync.

   Assembles dist/ from:
     site.config.json          what differs between sites (origin, nav, langs…)
     src/layout.html           the shell
     src/pages/<slug>.<lang>.html   the copy, each opening with a JSON <!--meta>
     src/styles/*.css          tokens + chrome + demo/portfolio
     static/                   fonts, assets, CNAME, robots.txt

   The first language in config.langs is served at the root; the others under
   /<lang>/. A one-language site therefore gets no prefix and no toggle.

   Usage: node build.mjs   →   dist/ */

import { readFile, writeFile, mkdir, rm, cp, readdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const DIST = join(ROOT, 'dist')

const config = JSON.parse(await readFile(join(ROOT, 'site.config.json'), 'utf8'))
const {
  origin,
  brand = 'Matías Podeley',
  ogImage = '/assets/og.png',
  repo = 'https://github.com/podeley',
  langs = ['es'],
  nav = [],
  backlink = null,
  footerLinks = null,
} = config

if (!origin) throw new Error('site.config.json: "origin" is required (e.g. "https://vm.podeley.ar")')
const DEFAULT_LANG = langs[0]

/* Sirve el sitio bajo un subpath en vez de la raíz del dominio: "/litio/" para
   podeley.github.io/sat-litio/, "/" para un dominio propio. Permite publicar en
   github.io antes de que exista el CNAME, sin tocar el copy — las páginas
   siguen escribiéndose con rutas absolutas tipo /assets/foo.png. */
const BASE = '/' + (config.basePath ?? '').replace(/^\/+|\/+$/g, '') + '/'
const withBase = (p) => (BASE === '/' ? p : p.replace(/^\//, BASE))

/* Chrome strings live here, not in each site — that is the point of the kit. */
const STRINGS = {
  es: {
    ogLocale: 'es_AR', navLabel: 'Secciones', skip: 'Ir al contenido', altLabel: 'EN',
    footNote: '© 2026 · Buenos Aires · Sitio estático en GitHub Pages',
    footSource: 'código del sitio',
    footFine: 'El trabajo se describe por sector; la identidad de los clientes es reservada.',
  },
  en: {
    ogLocale: 'en', navLabel: 'Sections', skip: 'Skip to content', altLabel: 'ES',
    footNote: '© 2026 · Buenos Aires · Static site on GitHub Pages',
    footSource: 'site source',
    footFine: 'Work is described by sector; client identities are private.',
  },
}

/* Every site's footer leads back into the funnel unless the site overrides it. */
const DEFAULT_FOOTER_LINKS = [
  { href: 'https://podeley.ar/', es: 'podeley.ar', en: 'podeley.ar' },
  { href: 'https://podeley.ar/ep/', es: 'E&P', en: 'E&P' },
  { href: 'https://podeley.ar/mineria/', es: 'Minería', en: 'Mining' },
  { href: 'https://podeley.ar/energia/', es: 'Gas y energía', en: 'Gas & power' },
  { href: 'https://podeley.ar/research/', es: 'Research', en: 'Research' },
]

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const urlFor = (slug, lang) => {
  const prefix = lang === DEFAULT_LANG ? BASE : `${BASE}${lang}/`
  return slug === 'index' ? prefix : `${prefix}${slug}/`
}

const outFor = (slug, lang) => {
  if (slug === '404') return join(DIST, '404.html')
  const dir = lang === DEFAULT_LANG ? DIST : join(DIST, lang)
  return slug === 'index' ? join(dir, 'index.html') : join(dir, slug, 'index.html')
}

const META_RE = /^\s*<!--meta\s*([\s\S]*?)-->\s*/

function parsePage(raw, file) {
  const m = raw.match(META_RE)
  if (!m) throw new Error(`${file}: missing the <!--meta … --> block`)
  let meta
  try {
    meta = JSON.parse(m[1])
  } catch (e) {
    throw new Error(`${file}: bad JSON in <!--meta>: ${e.message}`)
  }
  for (const k of ['title', 'description']) {
    if (!meta[k]) throw new Error(`${file}: meta.${k} is required`)
  }
  return { meta, body: raw.slice(m[0].length).trimEnd() }
}

/* A site has either a segment nav (the portfolio) or a backlink (a demo). */
function navHtml(lang, active) {
  const items = nav.map((i) => {
    const current = i.key === active ? ' aria-current="page"' : ''
    return `<a href="${urlFor(i.slug, lang)}"${current}>${esc(i[lang] ?? i.es)}</a>`
  })
  if (backlink) {
    items.push(`<a class="backlink" href="${backlink.href}">${esc(backlink[lang] ?? backlink.es)}</a>`)
  }
  return items.join('\n      ')
}

function footerHtml(lang) {
  const s = STRINGS[lang]
  // A site with its own segment nav (the portfolio) links the footer map to its
  // own pages, in the current language. A demo links out to podeley.ar.
  const links =
    footerLinks ??
    (nav.length
      ? [{ href: urlFor('index', lang), es: 'podeley.ar', en: 'podeley.ar' },
         ...nav.map((i) => ({ href: urlFor(i.slug, lang), es: i.es, en: i.en ?? i.es }))]
      : DEFAULT_FOOTER_LINKS)
  const map = links.map((l) => `<a href="${l.href}">${esc(l[lang] ?? l.es)}</a>`).join(' · ')
  return `  <div class="wrap foot-inner">
    <p class="foot-map">${map}</p>
    <p class="foot-note">${s.footNote} · <a href="${repo}">${s.footSource}</a></p>
  </div>
  <p class="wrap foot-fine">${s.footFine}</p>`
}

/* --- collect ------------------------------------------------------------- */

const files = (await readdir(join(SRC, 'pages'))).filter((f) => f.endsWith('.html')).sort()
const pages = []
for (const file of files) {
  const m = file.match(/^(.+)\.([a-z]{2})\.html$/)
  if (!m) throw new Error(`src/pages/${file}: name must be <slug>.<lang>.html`)
  const [, slug, lang] = m
  if (!langs.includes(lang)) throw new Error(`src/pages/${file}: "${lang}" is not in config.langs`)
  const raw = await readFile(join(SRC, 'pages', file), 'utf8')
  pages.push({ file, slug, lang, ...parsePage(raw, `src/pages/${file}`) })
}
if (!pages.length) throw new Error('src/pages/ is empty')

const have = new Set(pages.map((p) => `${p.slug}.${p.lang}`))

/* --- render -------------------------------------------------------------- */

const layout = await readFile(join(SRC, 'layout.html'), 'utf8')

await rm(DIST, { recursive: true, force: true })
await mkdir(DIST, { recursive: true })
const hasStatic = await access(join(ROOT, 'static')).then(() => true, () => false)
if (hasStatic) await cp(join(ROOT, 'static'), DIST, { recursive: true })
await cp(join(SRC, 'styles'), join(DIST, 'styles'), { recursive: true })

/* Stylesheets are whatever src/styles/ holds, cascade-ordered: identity layers
   first, the site's own last. No config, no layout edit when a layer is added. */
const ORDER = ['tokens.css', 'chrome.css', 'demo.css', 'portfolio.css', 'site.css']
const sheets = (await readdir(join(SRC, 'styles')))
  .filter((f) => f.endsWith('.css'))
  .sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b)
    return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib) || a.localeCompare(b)
  })
if (!sheets.includes('tokens.css')) {
  throw new Error('src/styles/tokens.css is missing — run node tools/sync-identity.mjs')
}
const stylesHtml = sheets.map((f) => `<link rel="stylesheet" href="${BASE}styles/${f}">`).join('\n')

for (const p of pages) {
  const s = STRINGS[p.lang]
  const other = langs.find((l) => l !== p.lang)
  const url = origin + urlFor(p.slug, p.lang)

  // 404 must not be indexed or cross-linked as a language variant.
  const isErrorPage = p.slug === '404'
  const translated = other ? have.has(`${p.slug}.${other}`) && !isErrorPage : false

  const canonical = isErrorPage
    ? '<meta name="robots" content="noindex">'
    : `<link rel="canonical" href="${url}">`
  const alternates = translated
    ? langs
        .map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}${urlFor(p.slug, l)}">`)
        .concat(`<link rel="alternate" hreflang="x-default" href="${origin}${urlFor(p.slug, DEFAULT_LANG)}">`)
        .join('\n')
    : ''

  // One language, or no counterpart page → no toggle at all.
  const toggle =
    other && !isErrorPage
      ? `<a class="lang-toggle" href="${translated ? urlFor(p.slug, other) : urlFor('index', other)}" hreflang="${other}" lang="${other}">${STRINGS[other].altLabel}</a>`
      : ''

  const html = layout
    .replaceAll('{{lang}}', p.lang)
    .replaceAll('{{og_locale}}', s.ogLocale)
    .replaceAll('{{title}}', esc(p.meta.title))
    .replaceAll('{{description}}', esc(p.meta.description))
    .replaceAll('{{url}}', url)
    .replaceAll('{{origin}}', origin)
    .replaceAll('{{og_image}}', ogImage.startsWith('http') ? ogImage : origin + withBase(ogImage))
    .replaceAll('{{canonical}}', canonical)
    .replaceAll('{{alternates}}', alternates)
    .replaceAll('{{styles}}', stylesHtml)
    .replaceAll('{{skip}}', esc(s.skip))
    .replaceAll('{{nav_label}}', esc(s.navLabel))
    .replaceAll('{{brand}}', esc(brand))
    .replaceAll('{{home}}', urlFor('index', p.lang))
    .replaceAll('{{nav}}', navHtml(p.lang, p.meta.nav))
    .replaceAll('{{lang_toggle}}', toggle)
    .replaceAll('{{footer}}', footerHtml(p.lang))
    .replaceAll('{{base}}', BASE)
    // El copy se escribe con rutas absolutas (/assets/foo.png); bajo un subpath
    // hay que reescribirlas. Sólo en el cuerpo: lo que genera el build ya sale
    // con BASE puesto, y así no se prefija dos veces.
    .replaceAll('{{body}}', BASE === '/' ? p.body : p.body.replace(/\b(href|src)="\/(?!\/)/g, `$1="${BASE}`))
    .replace(/\n{2,}(?=<(?:link|meta)\b)/g, '\n') // an empty slot must not gap <head>

  const out = outFor(p.slug, p.lang)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, html)
  console.log(`  ${out.slice(DIST.length + 1).padEnd(24)} ← src/pages/${p.file}`)
}

/* --- sitemap ------------------------------------------------------------- */

const locs = pages
  .filter((p) => p.slug !== '404')
  .map((p) => origin + urlFor(p.slug, p.lang))
  .sort()
await writeFile(
  join(DIST, 'sitemap.xml'),
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...locs.map((l) => `  <url><loc>${l}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n'),
)

console.log(`\n${pages.length} pages · ${locs.length} in sitemap.xml → dist/`)
