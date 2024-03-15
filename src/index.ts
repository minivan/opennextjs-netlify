import type { NetlifyPluginOptions } from '@netlify/build'

import { restoreBuildCache, saveBuildCache } from './build/cache.js'
import { copyPrerenderedContent } from './build/content/prerendered.js'
import {
  copyStaticAssets,
  copyStaticContent,
  copyStaticExport,
  publishStaticDir,
  unpublishStaticDir,
} from './build/content/static.js'
import { createEdgeHandlers } from './build/functions/edge.js'
import { createServerHandler } from './build/functions/server.js'
import { setImageConfig } from './build/image-cdn.js'
import { PluginContext } from './build/plugin-context.js'
import { verifyBuildConfig, verifyPublishDir } from './build/verification.js'

export const onPreBuild = async (options: NetlifyPluginOptions) => {
  // Enable Next.js standalone mode at build time
  process.env.NEXT_PRIVATE_STANDALONE = 'true'
  if (!options.constants.IS_LOCAL) {
    await restoreBuildCache(new PluginContext(options))
  }
}

export const onBuild = async (options: NetlifyPluginOptions) => {
  const ctx = new PluginContext(options)
  verifyPublishDir(ctx)
  verifyBuildConfig(ctx)

  // only save the build cache if not run via the CLI
  if (!options.constants.IS_LOCAL) {
    await saveBuildCache(ctx)
  }

  // static exports only need to be uploaded to the CDN
  if (ctx.buildConfig.output === 'export') {
    return copyStaticExport(ctx)
  }

  await Promise.all([
    copyStaticAssets(ctx),
    copyStaticContent(ctx),
    copyPrerenderedContent(ctx),
    createServerHandler(ctx),
    createEdgeHandlers(ctx),
    setImageConfig(ctx),
  ])
}

export const onPostBuild = async (options: NetlifyPluginOptions) => {
  await publishStaticDir(new PluginContext(options))
}

export const onSuccess = async () => {
  const prewarm = [process.env.DEPLOY_URL, process.env.DEPLOY_PRIME_URL, process.env.URL].filter(
    // If running locally then the deploy ID is a placeholder value. Filtering for `https://0--` removes it.
    (url?: string): url is string => Boolean(url && !url.startsWith('https://0--')),
  )
  await Promise.allSettled(prewarm.map((url) => fetch(url)))
}

export const onEnd = async (options: NetlifyPluginOptions) => {
  await unpublishStaticDir(new PluginContext(options))
}
