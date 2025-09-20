import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

export interface RouteInfo {
  path: string
  priority: number
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  lastmod?: string
}

export interface SitemapPluginOptions {
  /** Base URL for the sitemap (e.g., 'https://example.com') */
  baseUrl: string
  /** Path to TanStack Router's routeTree.gen.ts file */
  routeTreePath?: string
  /** Enable/disable sitemap generation */
  enabled?: boolean
  /** Custom route priority mapping function */
  getRoutePriority?: (route: string) => number
  /** Custom route changefreq mapping function */
  getRouteChangefreq?: (route: string) => RouteInfo['changefreq']
  /** Include robots.txt generation */
  includeRobots?: boolean
  /** Custom routes to include in sitemap */
  additionalRoutes?: string[]
  /** Routes to exclude from sitemap */
  excludeRoutes?: string[]
}

/**
 * Extract routes from TanStack Router's generated route tree
 */
function extractRoutesFromRouteTree(routeTreePath: string): string[] {
  try {
    if (!fs.existsSync(routeTreePath)) {
      console.warn(`Route tree file not found at: ${routeTreePath}`)
      return ['/']
    }

    const content = fs.readFileSync(routeTreePath, 'utf-8')

    // Extract multiple paths from union type like '/' | '/about' | '/contact'
    const unionMatch = content.match(/fullPaths:\s*([^\n]+)/)
    if (unionMatch) {
      const unionType = unionMatch[1]
      const pathMatches = unionType.match(/'([^']+)'/g)
      if (pathMatches) {
        return pathMatches.map(match => match.slice(1, -1)) // Remove quotes
      }
    }

    // Extract fullPaths type definition - handles single route (fallback)
    const singlePathMatch = content.match(/fullPaths:\s*'([^']+)'$/)
    if (singlePathMatch) {
      return [singlePathMatch[1]]
    }

    // Fallback: extract from FileRoutesByFullPath interface
    const interfaceMatch = content.match(/interface FileRoutesByFullPath \{([^}]+)\}/s)
    if (interfaceMatch) {
      const interfaceContent = interfaceMatch[1]
      const routes = interfaceContent.match(/'([^']+)':/g)
      if (routes) {
        return routes.map(route => route.slice(1, -2)) // Remove quotes and colon
      }
    }

    console.warn('Could not extract routes from route tree, using fallback')
    return ['/']
  } catch (error) {
    console.error('Error reading route tree:', error)
    return ['/']
  }
}

/**
 * Generate route metadata with SEO priorities
 */
function generateRouteMetadata(
  routes: string[],
  options: SitemapPluginOptions
): RouteInfo[] {
  const now = new Date().toISOString().split('T')[0]

  return routes.map(route => {
    // Custom priority function
    let priority = options.getRoutePriority?.(route) ?? getDefaultPriority(route)

    // Custom changefreq function
    let changefreq = options.getRouteChangefreq?.(route) ?? getDefaultChangefreq(route)

    return {
      path: route,
      priority,
      changefreq,
      lastmod: now
    }
  })
}

function getDefaultPriority(route: string): number {
  if (route === '/') return 1.0
  if (route.includes('/blog') || route.includes('/docs')) return 0.9
  if (route.includes('/api') || route.includes('/reference')) return 0.7
  return 0.8
}

function getDefaultChangefreq(route: string): RouteInfo['changefreq'] {
  if (route === '/') return 'daily'
  if (route.includes('/blog') || route.includes('/docs')) return 'weekly'
  if (route.includes('/api') || route.includes('/reference')) return 'monthly'
  return 'weekly'
}

/**
 * Generate XML sitemap content
 */
function generateSitemapXML(routes: RouteInfo[], baseUrl: string): string {
  const urls = routes.map(route => `  <url>
    <loc>${baseUrl}${route.path}</loc>
    <lastmod>${route.lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
}

/**
 * Generate robots.txt content
 */
function generateRobotsTxt(baseUrl: string): string {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml`
}

/**
 * Vite plugin for automatic sitemap generation from TanStack Router route tree
 */
export function sitemapPlugin(options: SitemapPluginOptions): Plugin {
  const {
    baseUrl,
    routeTreePath = 'src/routeTree.gen.ts',
    enabled = true,
    includeRobots = true,
    additionalRoutes = [],
    excludeRoutes = []
  } = options

  return {
    name: 'vite-plugin-sitemap',
    apply: 'build', // Only run during build

    closeBundle() {
      if (!enabled) {
        console.log('🗺️  Sitemap generation disabled')
        return
      }

      try {
        const fullRouteTreePath = path.resolve(process.cwd(), routeTreePath)
        const outputDir = path.resolve(process.cwd(), 'dist')

        console.log('🗺️  Generating sitemap...')

        // Extract routes from the generated route tree
        let routes = extractRoutesFromRouteTree(fullRouteTreePath)

        // Add additional routes
        routes = [...routes, ...additionalRoutes]

        // Remove excluded routes
        routes = routes.filter(route => !excludeRoutes.includes(route))

        // Remove duplicates
        routes = [...new Set(routes)]

        console.log(`📍 Found ${routes.length} routes:`, routes)

        // Generate route metadata
        const routeMetadata = generateRouteMetadata(routes, options)

        // Generate sitemap XML
        const sitemapXML = generateSitemapXML(routeMetadata, baseUrl)

        // Ensure output directory exists
        fs.mkdirSync(outputDir, { recursive: true })

        // Write sitemap.xml
        const sitemapPath = path.join(outputDir, 'sitemap.xml')
        fs.writeFileSync(sitemapPath, sitemapXML)
        console.log(`✅ Generated sitemap: ${sitemapPath}`)

        // Write robots.txt if enabled
        if (includeRobots) {
          const robotsTxt = generateRobotsTxt(baseUrl)
          const robotsPath = path.join(outputDir, 'robots.txt')
          fs.writeFileSync(robotsPath, robotsTxt)
          console.log(`✅ Generated robots.txt: ${robotsPath}`)
        }

        console.log(`🚀 Sitemap plugin: Generated ${routeMetadata.length} URLs`)
      } catch (error) {
        console.error('❌ Sitemap generation failed:', error)
        // Don't fail the build, just warn
      }
    }
  }
}

export default sitemapPlugin