import { defineConfig } from 'astro/config';

/**
 * The ShyTalk site (plan 3 Task 1, shyden-labs/ShyTalk#51): pre-built pages,
 * English at `/…` and each other language under `/<locale>/…`, served as
 * static assets by workers/web.
 *
 * `build.format: 'preserve'` writes `id/404.astro` as `id/404.html`, which
 * Cloudflare's asset router answers for an unknown `/id/…` path; the default
 * `directory` format writes `id/404/index.html`, which nothing finds
 * (measured by Yawelo Idle, shyden-labs/yawelo-idle#332). Styles stay in
 * files and nothing is inlined, so the CSP needs no 'unsafe-inline'.
 */
export default defineConfig({
  output: 'static',
  build: { format: 'preserve', inlineStylesheets: 'never' },
  vite: { build: { assetsInlineLimit: 0 } },
  i18n: {
    locales: ['en', 'id', 'th', 'vi', 'zh'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
});
