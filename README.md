# @mvp-kit/vite-sitemap-plugin

A Vite plugin for automatic sitemap generation from TanStack Router route tree.

## Features

- 🗺️ Automatic sitemap.xml generation from TanStack Router routes
- 🤖 robots.txt generation with sitemap reference
- ⚡ Build-time generation (zero runtime overhead)
- 🎯 SEO-optimized with customizable priorities and changefreq
- 🔧 Highly configurable with custom route handling
- 📦 TypeScript support

## Installation

```bash
npm install @mvp-kit/vite-sitemap-plugin
# or
pnpm add @mvp-kit/vite-sitemap-plugin
# or
yarn add @mvp-kit/vite-sitemap-plugin
```

## Usage

### Basic Setup

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { sitemapPlugin } from '@mvp-kit/vite-sitemap-plugin'

export default defineConfig({
  plugins: [
    // ... other plugins
    sitemapPlugin({
      baseUrl: 'https://your-domain.com'
    })
  ]
})
```

### Advanced Configuration

```typescript
sitemapPlugin({
  baseUrl: 'https://your-domain.com',
  routeTreePath: 'src/routeTree.gen.ts', // TanStack Router route tree
  enabled: process.env.NODE_ENV === 'production',
  includeRobots: true,
  additionalRoutes: ['/sitemap'], // Add custom routes
  excludeRoutes: ['/admin', '/private'], // Exclude routes
  getRoutePriority: (route) => {
    if (route === '/') return 1.0
    if (route.startsWith('/blog')) return 0.9
    return 0.8
  },
  getRouteChangefreq: (route) => {
    if (route === '/') return 'daily'
    if (route.startsWith('/blog')) return 'weekly'
    return 'monthly'
  }
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | **Required** | Base URL for the sitemap |
| `routeTreePath` | `string` | `'src/routeTree.gen.ts'` | Path to TanStack Router route tree |
| `enabled` | `boolean` | `true` | Enable/disable sitemap generation |
| `includeRobots` | `boolean` | `true` | Generate robots.txt file |
| `additionalRoutes` | `string[]` | `[]` | Additional routes to include |
| `excludeRoutes` | `string[]` | `[]` | Routes to exclude from sitemap |
| `getRoutePriority` | `(route: string) => number` | Default logic | Custom priority function |
| `getRouteChangefreq` | `(route: string) => string` | Default logic | Custom changefreq function |

## Default SEO Settings

| Route Pattern | Priority | Change Frequency |
|---------------|----------|------------------|
| `/` (Homepage) | 1.0 | daily |
| `/blog/*`, `/docs/*` | 0.9 | weekly |
| `/api/*`, `/reference/*` | 0.7 | monthly |
| Other routes | 0.8 | weekly |

## Output

The plugin generates two files in your build output:

### sitemap.xml
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://your-domain.com/</loc>
    <lastmod>2025-09-19</lastmod>
    <changefreq>daily</changefreq>
    <priority>1</priority>
  </url>
  <!-- More URLs... -->
</urlset>
```

### robots.txt
```
User-agent: *
Allow: /

Sitemap: https://your-domain.com/sitemap.xml
```

## How It Works

1. **Route Detection**: Parses TanStack Router's `routeTree.gen.ts` to extract all routes
2. **SEO Optimization**: Applies intelligent defaults or custom logic for priorities and change frequencies
3. **Build Integration**: Runs during Vite's build process using the `closeBundle` hook
4. **File Generation**: Creates sitemap.xml and robots.txt in the output directory

## TypeScript Support

The plugin is written in TypeScript and includes full type definitions.

```typescript
import type { SitemapPluginOptions, RouteInfo } from '@mvp-kit/vite-sitemap-plugin'
```

## License

MIT