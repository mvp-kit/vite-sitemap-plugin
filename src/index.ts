import fs from 'node:fs'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

export type Changefreq = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'

export type RouteMatcher = string | RegExp | ((route: string) => boolean)

export type RoutesInput = string[] | (() => string[] | Promise<string[]>)

export type RobotsTxtOptions =
  | boolean
  | {
      mode?: 'append' | 'overwrite' | 'skip'
      rules?: string[]
    }

export interface RouteInfo {
  path: string
  priority: number
  changefreq: Changefreq
  lastmod?: string
  images?: string[]
}

export interface SitemapPluginOptions {
  /** Absolute production URL for the site, for example https://example.com. */
  baseUrl: string
  /** Path to TanStack Router's routeTree.gen.ts file, resolved from Vite root. */
  routeTreePath?: string
  /** Explicit routes to include, or a callback that resolves them at build time. */
  routes?: RoutesInput
  /** Enable or disable sitemap generation. */
  enabled?: boolean
  /** Fail the Vite build on sitemap warnings or generation errors. */
  strict?: boolean
  /** Generate or update robots.txt. Defaults to append/create behavior. */
  robotsTxt?: RobotsTxtOptions
  /** Routes to exclude from sitemap output. */
  excludeRoutes?: RouteMatcher[]
  /** Custom route priority mapping function. */
  getRoutePriority?: (route: string) => number
  /** Custom route changefreq mapping function. */
  getRouteChangefreq?: (route: string) => Changefreq
  /** Custom route lastmod mapping function. */
  getRouteLastmod?: (route: string) => string | Date | undefined
  /** Custom route image mapping function. */
  getRouteImages?: (route: string) => string[] | Promise<string[]>
  /** Log route-level diagnostics. */
  verbose?: boolean
}

interface RouteCollection {
  routes: string[]
  excluded: number
  skippedDynamic: number
}

interface NormalizedBaseUrl {
  value: string
  warnings: string[]
}

interface RobotsResult {
  mode: 'append' | 'create' | 'overwrite' | 'skip'
  path: string
}

const validChangefreq = new Set<Changefreq>([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
])

/**
 * Extract routes from TanStack Router's generated route tree.
 */
function extractRoutesFromRouteTree(routeTreePath: string): string[] {
  if (!fs.existsSync(routeTreePath)) {
    return []
  }

  const content = fs.readFileSync(routeTreePath, 'utf-8')
  const routes = new Set<string>()

  for (const match of content.matchAll(/fullPaths:\s*([^;\n]+)/g)) {
    for (const routeMatch of match[1].matchAll(/'([^']+)'/g)) {
      routes.add(routeMatch[1])
    }
  }

  const interfaceMatch = content.match(/interface FileRoutesByFullPath\s*\{([^}]+)\}/s)
  if (interfaceMatch) {
    for (const routeMatch of interfaceMatch[1].matchAll(/'([^']+)':/g)) {
      routes.add(routeMatch[1])
    }
  }

  return [...routes]
}

function normalizeBaseUrl(rawBaseUrl: string, strict: boolean, isProductionBuild: boolean): NormalizedBaseUrl {
  const value = rawBaseUrl.trim().replace(/\/+$/, '')
  const warnings: string[] = []

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`baseUrl must be a valid absolute URL: ${rawBaseUrl}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`baseUrl must use http or https: ${rawBaseUrl}`)
  }

  if (url.protocol !== 'https:') {
    warnings.push(`baseUrl should use https in production: ${value}`)
  }

  if (isProductionBuild && isLocalhost(url.hostname)) {
    warnings.push(`baseUrl points to localhost during a production build: ${value}`)
  }

  if (strict && warnings.length > 0) {
    throw new Error(warnings.join('; '))
  }

  return { value, warnings }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.')
}

function normalizeRoutePath(route: string): string | undefined {
  const trimmed = route.trim()
  if (!trimmed) return undefined

  const [withoutHash] = trimmed.split('#')
  const [pathname, query = ''] = withoutHash.split('?')
  const normalizedPath = `/${pathname.replace(/^\/+/, '')}`
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '') || '/'

  return query ? `${normalizedPath}?${query}` : normalizedPath
}

function joinUrl(baseUrl: string, route: string): string {
  if (route === '/') return `${baseUrl}/`
  return `${baseUrl}/${route.replace(/^\/+/, '')}`
}

function routeMatcherMatches(matcher: RouteMatcher, route: string): boolean {
  if (typeof matcher === 'function') return matcher(route)
  if (matcher instanceof RegExp) return matcher.test(route)

  if (matcher.endsWith('/**')) {
    const prefix = normalizeRoutePath(matcher.slice(0, -3)) ?? '/'
    return route === prefix || route.startsWith(`${prefix}/`)
  }

  return route === normalizeRoutePath(matcher)
}

async function resolveRoutesInput(routes: RoutesInput | undefined): Promise<string[]> {
  if (!routes) return []
  if (typeof routes === 'function') return routes()
  return routes
}

async function collectRoutes(
  options: SitemapPluginOptions,
  viteRoot: string,
  logVerbose: (message: string) => void
): Promise<RouteCollection> {
  const routeCandidates: string[] = []

  if (options.routeTreePath) {
    const routeTreePath = path.resolve(viteRoot, options.routeTreePath)
    if (!fs.existsSync(routeTreePath)) {
      const message = `routeTreePath not found: ${routeTreePath}`
      if (options.strict) throw new Error(message)
      console.warn(`[vite-sitemap] ${message}`)
    }

    const routeTreeRoutes = extractRoutesFromRouteTree(routeTreePath)
    if (routeTreeRoutes.length === 0) {
      logVerbose(`route tree produced no routes: ${routeTreePath}`)
    }

    logVerbose(`route tree: ${routeTreePath} (${routeTreeRoutes.length} routes)`)
    routeCandidates.push(...routeTreeRoutes)
  }

  const explicitRoutes = await resolveRoutesInput(options.routes)
  logVerbose(`explicit routes: ${explicitRoutes.length}`)
  routeCandidates.push(...explicitRoutes)

  const normalizedRoutes = new Set<string>()
  for (const route of routeCandidates) {
    const normalized = normalizeRoutePath(route)
    if (normalized) normalizedRoutes.add(normalized)
  }

  const routes: string[] = []
  let excluded = 0
  let skippedDynamic = 0

  for (const route of normalizedRoutes) {
    if (isDynamicRoute(route)) {
      skippedDynamic += 1
      logVerbose(`skipped dynamic route: ${route}`)
      continue
    }

    if (isDefaultExcludedRoute(route)) {
      excluded += 1
      logVerbose(`excluded default route: ${route}`)
      continue
    }

    if (options.excludeRoutes?.some(matcher => routeMatcherMatches(matcher, route))) {
      excluded += 1
      logVerbose(`excluded route: ${route}`)
      continue
    }

    routes.push(route)
  }

  return { routes, excluded, skippedDynamic }
}

function isDynamicRoute(route: string): boolean {
  return route.includes('$')
}

function isDefaultExcludedRoute(route: string): boolean {
  return route === '/404'
}

async function generateRouteMetadata(
  routes: string[],
  options: SitemapPluginOptions,
  baseUrl: string
): Promise<RouteInfo[]> {
  const today = new Date().toISOString().split('T')[0]

  return Promise.all(
    routes.map(async route => {
      const priority = options.getRoutePriority?.(route) ?? getDefaultPriority(route)
      if (!Number.isFinite(priority) || priority < 0 || priority > 1) {
        throw new Error(`Invalid priority for ${route}: expected a value from 0.0 to 1.0`)
      }

      const changefreq = options.getRouteChangefreq?.(route) ?? getDefaultChangefreq(route)
      if (!validChangefreq.has(changefreq)) {
        throw new Error(`Invalid changefreq for ${route}: ${changefreq}`)
      }

      const lastmodValue = options.getRouteLastmod?.(route)
      const images = await options.getRouteImages?.(route)

      return {
        path: route,
        priority,
        changefreq,
        lastmod: formatLastmod(lastmodValue) ?? today,
        images: images?.map(image => normalizeImageUrl(image, baseUrl)),
      }
    })
  )
}

function formatLastmod(lastmod: string | Date | undefined): string | undefined {
  if (!lastmod) return undefined
  return lastmod instanceof Date ? lastmod.toISOString() : lastmod
}

function normalizeImageUrl(image: string, baseUrl: string): string {
  const trimmed = image.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed
  } catch {
    // Treat non-absolute image entries as site-relative paths.
  }

  const normalized = normalizeRoutePath(trimmed)
  if (!normalized) throw new Error(`Invalid image URL/path: ${image}`)
  return joinUrl(baseUrl, normalized)
}

function getDefaultPriority(route: string): number {
  if (route === '/') return 1.0
  if (route.includes('/blog') || route.includes('/docs')) return 0.9
  if (route.includes('/api') || route.includes('/reference')) return 0.7
  return 0.8
}

function getDefaultChangefreq(route: string): Changefreq {
  if (route === '/') return 'daily'
  if (route.includes('/blog') || route.includes('/docs')) return 'weekly'
  if (route.includes('/api') || route.includes('/reference')) return 'monthly'
  return 'weekly'
}

function generateSitemapXML(routes: RouteInfo[], baseUrl: string): string {
  const hasImages = routes.some(route => route.images && route.images.length > 0)
  const imageNamespace = hasImages ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : ''
  const urls = routes
    .map(route => {
      const imageTags = route.images?.length
        ? `\n${route.images.map(image => `    <image:image>\n      <image:loc>${escapeXml(image)}</image:loc>\n    </image:image>`).join('\n')}`
        : ''

      return `  <url>
    <loc>${escapeXml(joinUrl(baseUrl, route.path))}</loc>
    <lastmod>${escapeXml(route.lastmod ?? '')}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${formatPriority(route.priority)}</priority>${imageTags}
  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${imageNamespace}>
${urls}
</urlset>
`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatPriority(priority: number): string {
  return Number.isInteger(priority) ? String(priority) : String(priority)
}

function writeRobotsTxt(outputDir: string, baseUrl: string, robotsTxt: RobotsTxtOptions | undefined): RobotsResult {
  const option = robotsTxt ?? { mode: 'append' as const }
  const robotsPath = path.join(outputDir, 'robots.txt')

  if (option === false || (typeof option === 'object' && option.mode === 'skip')) {
    return { mode: 'skip', path: robotsPath }
  }

  const mode = typeof option === 'object' ? option.mode ?? 'append' : 'append'
  const rules = typeof option === 'object' ? option.rules ?? defaultRobotsRules() : defaultRobotsRules()
  const sitemapLine = `Sitemap: ${baseUrl}/sitemap.xml`
  const robotsBlock = [...rules, '', sitemapLine].join('\n').trimEnd()

  if (mode === 'overwrite') {
    fs.writeFileSync(robotsPath, `${robotsBlock}\n`)
    return { mode: 'overwrite', path: robotsPath }
  }

  if (!fs.existsSync(robotsPath)) {
    fs.writeFileSync(robotsPath, `${robotsBlock}\n`)
    return { mode: 'create', path: robotsPath }
  }

  const existing = fs.readFileSync(robotsPath, 'utf-8').trimEnd()
  if (!existing.includes(sitemapLine)) {
    fs.writeFileSync(robotsPath, `${existing}\n\n${sitemapLine}\n`)
  }

  return { mode: 'append', path: robotsPath }
}

function defaultRobotsRules(): string[] {
  return ['User-agent: *', 'Allow: /']
}

function resolveOutputDir(config: ResolvedConfig | undefined): string {
  const root = config?.root ?? process.cwd()
  const outDir = config?.build.outDir ?? 'dist'
  return path.resolve(root, outDir)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Vite plugin for sitemap.xml and robots.txt generation.
 */
export function sitemapPlugin(options: SitemapPluginOptions): Plugin {
  const {
    enabled = true,
    strict = false,
    verbose = false,
  } = options

  let resolvedConfig: ResolvedConfig | undefined

  return {
    name: 'vite-plugin-sitemap',
    apply: 'build',

    configResolved(config) {
      resolvedConfig = config
    },

    async closeBundle() {
      if (!enabled) {
        console.info('[vite-sitemap] generation disabled')
        return
      }

      try {
        const outputDir = resolveOutputDir(resolvedConfig)
        const viteRoot = resolvedConfig?.root ?? process.cwd()
        const isProductionBuild = resolvedConfig?.command === 'build' && resolvedConfig.mode === 'production'
        const logVerbose = (message: string) => {
          if (verbose) console.info(`[vite-sitemap] ${message}`)
        }

        const baseUrl = normalizeBaseUrl(options.baseUrl, strict, isProductionBuild)
        for (const warning of baseUrl.warnings) {
          console.warn(`[vite-sitemap] ${warning}`)
        }

        const routeCollection = await collectRoutes(options, viteRoot, logVerbose)
        const routeMetadata = await generateRouteMetadata(routeCollection.routes, options, baseUrl.value)

        fs.mkdirSync(outputDir, { recursive: true })

        const sitemapPath = path.join(outputDir, 'sitemap.xml')
        fs.writeFileSync(sitemapPath, generateSitemapXML(routeMetadata, baseUrl.value))

        const robotsResult = writeRobotsTxt(outputDir, baseUrl.value, options.robotsTxt)

        console.info(
          `[vite-sitemap] sitemap=${sitemapPath} robots=${robotsResult.mode} urls=${routeMetadata.length} excluded=${routeCollection.excluded} skippedDynamic=${routeCollection.skippedDynamic}`
        )

        logVerbose(`robots path: ${robotsResult.path}`)
        for (const route of routeMetadata) {
          logVerbose(`url: ${joinUrl(baseUrl.value, route.path)}`)
        }
      } catch (error) {
        if (strict) throw error
        console.warn(`[vite-sitemap] generation skipped: ${formatError(error)}`)
      }
    },
  }
}

export default sitemapPlugin
