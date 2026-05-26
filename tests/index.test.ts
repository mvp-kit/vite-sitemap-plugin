import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from 'vite'
import { sitemapPlugin, type SitemapPluginOptions } from '../src/index'

function createTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vite-sitemap-plugin-'))
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function createConfig(root: string, outDir = 'dist', mode = 'production'): ResolvedConfig {
  return {
    root,
    mode,
    command: 'build',
    build: { outDir },
  } as ResolvedConfig
}

async function runPlugin(options: SitemapPluginOptions, config: ResolvedConfig): Promise<string> {
  const plugin = sitemapPlugin(options) as any
  plugin.configResolved(config)
  await plugin.closeBundle()
  return path.resolve(config.root, config.build.outDir)
}

function readOutput(outputDir: string, fileName: string): string {
  return fs.readFileSync(path.join(outputDir, fileName), 'utf-8')
}

function writeRouteTree(root: string, routes: string[]): void {
  writeFile(
    path.join(root, 'src/routeTree.gen.ts'),
    `export interface FileRoutesByFullPath {\n${routes.map(route => `  '${route}': unknown`).join('\n')}\n}\n`
  )
}

describe('sitemapPlugin', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves routeTreePath from Vite root and writes to Vite build.outDir', async () => {
    const repoRoot = createTempProject()
    const appRoot = path.join(repoRoot, 'apps/web')
    writeRouteTree(appRoot, ['/', '/about'])

    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routeTreePath: 'src/routeTree.gen.ts',
        robotsTxt: false,
      },
      createConfig(appRoot, '../../build/web')
    )

    expect(outputDir).toBe(path.join(repoRoot, 'build/web'))
    expect(fs.existsSync(path.join(outputDir, 'sitemap.xml'))).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'dist/sitemap.xml'))).toBe(false)
    expect(readOutput(outputDir, 'sitemap.xml')).toContain('<loc>https://example.com/about</loc>')
  })

  it('normalizes baseUrl, joins route paths, and XML-escapes loc output', async () => {
    const root = createTempProject()
    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com/',
        routes: ['about', '/search?x=1&y=<two>'],
        robotsTxt: false,
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap).toContain('<loc>https://example.com/about</loc>')
    expect(sitemap).toContain('<loc>https://example.com/search?x=1&amp;y=&lt;two&gt;</loc>')
    expect(sitemap).not.toContain('https://example.com//about')
  })

  it('supports robots append, overwrite, and skip modes', async () => {
    const appendRoot = createTempProject()
    const appendConfig = createConfig(appendRoot)
    const appendOutput = path.resolve(appendConfig.root, appendConfig.build.outDir)
    writeFile(path.join(appendOutput, 'robots.txt'), 'User-agent: Googlebot\nDisallow: /tmp\n')

    await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/'],
      },
      appendConfig
    )

    expect(readOutput(appendOutput, 'robots.txt')).toBe(
      'User-agent: Googlebot\nDisallow: /tmp\n\nSitemap: https://example.com/sitemap.xml\n'
    )

    const overwriteRoot = createTempProject()
    const overwriteConfig = createConfig(overwriteRoot)
    const overwriteOutput = path.resolve(overwriteConfig.root, overwriteConfig.build.outDir)
    writeFile(path.join(overwriteOutput, 'robots.txt'), 'Disallow: /\n')

    await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/'],
        robotsTxt: { mode: 'overwrite', rules: ['User-agent: *', 'Disallow: /private'] },
      },
      overwriteConfig
    )

    expect(readOutput(overwriteOutput, 'robots.txt')).toBe(
      'User-agent: *\nDisallow: /private\n\nSitemap: https://example.com/sitemap.xml\n'
    )

    const skipRoot = createTempProject()
    const skipOutput = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/'],
        robotsTxt: { mode: 'skip' },
      },
      createConfig(skipRoot)
    )

    expect(fs.existsSync(path.join(skipOutput, 'robots.txt'))).toBe(false)
  })

  it('fails the build in strict mode', async () => {
    const root = createTempProject()
    await expect(
      runPlugin(
        {
          baseUrl: 'http://localhost:5173',
          routes: ['/'],
          strict: true,
          robotsTxt: false,
        },
        createConfig(root)
      )
    ).rejects.toThrow('baseUrl should use https')
  })

  it('rejects non-finite route priorities', async () => {
    const root = createTempProject()
    await expect(
      runPlugin(
        {
          baseUrl: 'https://example.com',
          routes: ['/'],
          strict: true,
          robotsTxt: false,
          getRoutePriority: () => Number.NaN,
        },
        createConfig(root)
      )
    ).rejects.toThrow('Invalid priority')
  })

  it('merges route tree and explicit routes, normalizes, and deduplicates', async () => {
    const root = createTempProject()
    writeRouteTree(root, ['/', '/about'])

    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routeTreePath: 'src/routeTree.gen.ts',
        routes: async () => ['/about/', 'contact', '/contact'],
        robotsTxt: false,
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap.match(/<url>/g)).toHaveLength(3)
    expect(sitemap).toContain('<loc>https://example.com/</loc>')
    expect(sitemap).toContain('<loc>https://example.com/about</loc>')
    expect(sitemap).toContain('<loc>https://example.com/contact</loc>')
  })

  it('excludes routes with exact strings, prefix globs, RegExp, and predicates', async () => {
    const root = createTempProject()
    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/admin', '/docs/a', '/docs/b', '/blog/a', '/private', '/keep'],
        excludeRoutes: ['/admin', '/docs/**', /^\/blog/, route => route === '/private'],
        robotsTxt: false,
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap.match(/<url>/g)).toHaveLength(1)
    expect(sitemap).toContain('<loc>https://example.com/keep</loc>')
  })

  it('skips dynamic and default non-indexable routes', async () => {
    const root = createTempProject()
    writeRouteTree(root, ['/', '/posts/$postId', '/404'])

    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routeTreePath: 'src/routeTree.gen.ts',
        routes: ['/posts/hello'],
        robotsTxt: false,
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap).toContain('<loc>https://example.com/</loc>')
    expect(sitemap).toContain('<loc>https://example.com/posts/hello</loc>')
    expect(sitemap).not.toContain('$postId')
    expect(sitemap).not.toContain('/404')
  })

  it('writes lastmod from Date and string hooks', async () => {
    const root = createTempProject()
    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/', '/about'],
        robotsTxt: false,
        getRouteLastmod: route => (route === '/' ? new Date('2024-01-01T12:00:00.000Z') : '2024-01-02'),
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap).toContain('<lastmod>2024-01-01T12:00:00.000Z</lastmod>')
    expect(sitemap).toContain('<lastmod>2024-01-02</lastmod>')
  })

  it('writes image sitemap entries', async () => {
    const root = createTempProject()
    const outputDir = await runPlugin(
      {
        baseUrl: 'https://example.com',
        routes: ['/about'],
        robotsTxt: false,
        getRouteImages: async () => ['/images/hero&one.jpg', 'https://cdn.example.com/a.jpg?x=1&y=2'],
      },
      createConfig(root)
    )

    const sitemap = readOutput(outputDir, 'sitemap.xml')
    expect(sitemap).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
    expect(sitemap).toContain('<image:loc>https://example.com/images/hero&amp;one.jpg</image:loc>')
    expect(sitemap).toContain('<image:loc>https://cdn.example.com/a.jpg?x=1&amp;y=2</image:loc>')
  })
})
