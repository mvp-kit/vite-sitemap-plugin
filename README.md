# @mvp-kit/vite-sitemap-plugin

[![npm version](https://img.shields.io/npm/v/@mvp-kit/vite-sitemap-plugin.svg)](https://www.npmjs.com/package/@mvp-kit/vite-sitemap-plugin)
[![license](https://img.shields.io/npm/l/@mvp-kit/vite-sitemap-plugin.svg)](LICENSE)

Keep your sitemap current with each Vite build.

`@mvp-kit/vite-sitemap-plugin` generates `sitemap.xml` from TanStack Router's `routeTree.gen.ts`, an explicit route list, or both. It writes to Vite's actual build output directory, works in monorepos, and can update `robots.txt` with the sitemap URL.

## Features

- Read TanStack Router routes from `routeTree.gen.ts`
- Add explicit routes or load them asynchronously
- Write to Vite's resolved `build.outDir`
- Normalize and validate `baseUrl`
- Skip unresolved dynamic routes such as `/blog/$slug`
- Exclude routes by path, `/**` glob, regex, or predicate
- Add `lastmod`, priority, changefreq, and image metadata per route
- Append, overwrite, or skip `robots.txt`
- Fail the build in strict mode

Sitemap indexes and sitemap splitting are not included in this release.

## Install

```bash
npm install @mvp-kit/vite-sitemap-plugin
```

## Quick Start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { sitemapPlugin } from '@mvp-kit/vite-sitemap-plugin'

export default defineConfig({
  plugins: [
    sitemapPlugin({
      baseUrl: 'https://example.com',
      routes: ['/', '/about', '/pricing'],
    }),
  ],
})
```

Run `vite build`. The plugin writes `sitemap.xml` to Vite's resolved `build.outDir`.

## TanStack Router

```ts
sitemapPlugin({
  baseUrl: 'https://example.com',
  routeTreePath: 'src/routeTree.gen.ts',
  routes: ['/blog/hello-world'],
  strict: true,
})
```

`routeTreePath` is resolved from Vite `root`. Routes from the route tree and `routes` are normalized, merged, and deduplicated.

Dynamic route patterns are skipped. Add concrete URLs through `routes`.

## Explicit Routes

Use `routes` when URLs come from content, CMS data, or another route source.

```ts
sitemapPlugin({
  baseUrl: 'https://example.com',
  routes: async () => {
    const posts = await loadPublishedPosts()
    return ['/', '/docs', ...posts.map(post => `/blog/${post.slug}`)]
  },
})
```

## Cloudflare Pages

```ts
// vite.config.ts
import { defineConfig, loadEnv } from 'vite'
import { sitemapPlugin } from '@mvp-kit/vite-sitemap-plugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    build: {
      outDir: 'dist',
    },
    plugins: [
      sitemapPlugin({
        baseUrl: env.PUBLIC_SITE_URL,
        routeTreePath: 'src/routeTree.gen.ts',
        strict: mode === 'production',
      }),
    ],
  }
})
```

Set `PUBLIC_SITE_URL` to the canonical URL, for example `https://example.com`.

## robots.txt

By default, the plugin creates `robots.txt` when missing and appends a `Sitemap:` line when the file already exists.

```ts
sitemapPlugin({
  baseUrl: 'https://example.com',
  routes: ['/'],
  robotsTxt: {
    mode: 'overwrite',
    rules: ['User-agent: *', 'Disallow: /private'],
  },
})
```

Set `robotsTxt: false` or `robotsTxt: { mode: 'skip' }` to leave the file untouched.

## Route Metadata

```ts
sitemapPlugin({
  baseUrl: 'https://example.com',
  routes: ['/', '/docs', '/blog/hello-world'],
  getRoutePriority: route => (route === '/' ? 1 : 0.8),
  getRouteChangefreq: route => (route.startsWith('/blog') ? 'weekly' : 'monthly'),
  getRouteLastmod: route => (route.startsWith('/blog') ? '2026-05-26' : undefined),
  getRouteImages: async route => (route === '/' ? ['/images/social-card.jpg'] : []),
})
```

`priority` must be between `0.0` and `1.0`. `changefreq` must be one of `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`, or `never`.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | Required | Absolute site URL. Trailing slashes are removed. |
| `routeTreePath` | `string` | `undefined` | TanStack Router route tree path, resolved from Vite root. |
| `routes` | `string[] \| (() => string[] \| Promise<string[]>)` | `[]` | Explicit route list or async route loader. |
| `enabled` | `boolean` | `true` | Enables sitemap generation. |
| `strict` | `boolean` | `false` | Throws on URL warnings and generation errors. |
| `robotsTxt` | `boolean \| RobotsTxtOptions` | `{ mode: 'append' }` | Controls `robots.txt` output. |
| `excludeRoutes` | `RouteMatcher[]` | `[]` | Excludes exact routes, `/**` globs, regex matches, or predicate matches. |
| `getRoutePriority` | `(route: string) => number` | Built-in defaults | Returns sitemap priority from `0.0` to `1.0`. |
| `getRouteChangefreq` | `(route: string) => Changefreq` | Built-in defaults | Returns sitemap change frequency. |
| `getRouteLastmod` | `(route: string) => string \| Date \| undefined` | Build date | Returns per-route `lastmod`. |
| `getRouteImages` | `(route: string) => string[] \| Promise<string[]>` | `undefined` | Returns absolute or site-relative image URLs. |
| `verbose` | `boolean` | `false` | Logs route-level details. |

```ts
type RouteMatcher = string | RegExp | ((route: string) => boolean)

type RobotsTxtOptions =
  | boolean
  | {
      mode?: 'append' | 'overwrite' | 'skip'
      rules?: string[]
    }
```

## Output

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-05-26</lastmod>
    <changefreq>daily</changefreq>
    <priority>1</priority>
  </url>
</urlset>
```

Image metadata adds the image sitemap namespace and `image:image` entries.

## License

MIT
