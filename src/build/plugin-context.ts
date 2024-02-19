import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
// Here we need to actually import `resolve` from node:path as we want to resolve the paths
// eslint-disable-next-line no-restricted-imports
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  NetlifyPluginConstants,
  NetlifyPluginOptions,
  NetlifyPluginUtils,
} from '@netlify/build'
import type { PrerenderManifest, RoutesManifest } from 'next/dist/build/index.js'
import type { MiddlewareManifest } from 'next/dist/build/webpack/plugins/middleware-plugin.js'
import type { NextConfigComplete } from 'next/dist/server/config-shared.js'

const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))
const PLUGIN_DIR = join(MODULE_DIR, '../..')
const DEFAULT_PUBLISH_DIR = '.next'

export const SERVER_HANDLER_NAME = '___netlify-server-handler'
export const EDGE_HANDLER_NAME = '___netlify-edge-handler'

export class PluginContext {
  utils: NetlifyPluginUtils
  netlifyConfig: NetlifyPluginOptions['netlifyConfig']
  pluginName: string
  pluginVersion: string

  private constants: NetlifyPluginConstants
  private packageJSON: { name: string; version: string } & Record<string, unknown>

  /** Absolute path of the next runtime plugin directory */
  pluginDir = PLUGIN_DIR

  get relPublishDir(): string {
    return this.constants.PUBLISH_DIR ?? join(this.packagePath, DEFAULT_PUBLISH_DIR)
  }

  /** Temporary directory for stashing the build output */
  get tempPublishDir(): string {
    return this.resolve('.netlify/.next')
  }

  /** Absolute path of the publish directory */
  get publishDir(): string {
    // Does not need to be resolved with the package path as it is always a repository absolute path
    // hence including already the `PACKAGE_PATH` therefore we don't use the `this.resolve`
    return resolve(this.relPublishDir)
  }

  /**
   * Relative package path in non monorepo setups this is an empty string
   * @example ''
   * @example 'apps/my-app'
   */
  get packagePath(): string {
    return this.constants.PACKAGE_PATH || ''
  }

  /**
   * The working directory inside the lambda that is used for monorepos to execute the serverless function
   */
  get lambdaWorkingDirectory(): string {
    return join('/var/task', this.distFolder)
  }

  /**
   * Retrieves the root of the `.next/standalone` directory
   */
  get standaloneRootDir(): string {
    return join(this.publishDir, 'standalone')
  }

  /**
   * The resolved relative next dist directory defaults to `.next`,
   * but can be configured through the next.config.js. For monorepos this will include the packagePath
   * If we need just the plain dist dir use the `nextDistDir`
   */
  get distDir(): string {
    const dir = this.buildConfig.distDir ?? DEFAULT_PUBLISH_DIR
    // resolve the distDir relative to the process working directory in case it contains '../../'
    return relative(process.cwd(), resolve(this.packagePath, dir))
  }

  /** The dist folder represents the parent directory of the .next folder or custom distDir */
  get distFolder(): string {
    // the .. is omitting the last part of the dist dir like `.next` but as it can be any custom folder
    // let's just move one directory up with that
    return join(this.distDir, '..')
  }

  /** The `.next` folder or what the custom dist dir is set to */
  get nextDistDir(): string {
    return relative(this.distFolder, this.distDir)
  }

  /** Retrieves the `.next/standalone/` directory monorepo aware */
  get standaloneDir(): string {
    // the standalone directory mimics the structure of the publish directory
    // that said if the publish directory is `apps/my-app/.next` the standalone directory will be `.next/standalone/apps/my-app`
    // if the publish directory is .next the standalone directory will be `.next/standalone`
    // for nx workspaces where the publish directory is on the root of the repository
    // like `dist/apps/my-app/.next` the standalone directory will be `.next/standalone/dist/apps/my-app`
    return join(this.standaloneRootDir, this.distFolder)
  }

  /**
   * Absolute path of the directory that is published and deployed to the Netlify CDN
   * Will be swapped with the publish directory
   * `.netlify/static`
   */
  get staticDir(): string {
    return this.resolve('.netlify/static')
  }

  /**
   * Absolute path of the directory that will be deployed to the blob store
   * `.netlify/blobs/deploy`
   */
  get blobDir(): string {
    return this.resolve('.netlify/blobs/deploy')
  }

  /**
   * Absolute path of the directory containing the files for the serverless lambda function
   * `.netlify/functions-internal`
   */
  get serverFunctionsDir(): string {
    return this.resolve('.netlify/functions-internal')
  }

  /** Absolute path of the server handler */
  get serverHandlerRootDir(): string {
    return join(this.serverFunctionsDir, SERVER_HANDLER_NAME)
  }

  get serverHandlerDir(): string {
    if (this.packagePath.length === 0) {
      return this.serverHandlerRootDir
    }
    return join(this.serverHandlerRootDir, this.distFolder)
  }

  get nextServerHandler(): string {
    if (this.packagePath.length !== 0) {
      return join(this.lambdaWorkingDirectory, '.netlify/dist/run/handlers/server.js')
    }
    return './.netlify/dist/run/handlers/server.js'
  }

  /**
   * Absolute path of the directory containing the files for deno edge functions
   * `.netlify/edge-functions`
   */
  get edgeFunctionsDir(): string {
    return this.resolve('.netlify/edge-functions')
  }

  /** Absolute path of the edge handler */
  get edgeHandlerDir(): string {
    return join(this.edgeFunctionsDir, EDGE_HANDLER_NAME)
  }

  constructor(options: NetlifyPluginOptions) {
    this.packageJSON = JSON.parse(readFileSync(join(PLUGIN_DIR, 'package.json'), 'utf-8'))
    this.pluginName = this.packageJSON.name
    this.pluginVersion = this.packageJSON.version
    this.constants = options.constants
    this.utils = options.utils
    this.netlifyConfig = options.netlifyConfig
  }

  /** Resolves a path correctly with mono repository awareness  */
  resolve(...args: string[]): string {
    return resolve(this.constants.PACKAGE_PATH || '', ...args)
  }

  /** Get the next prerender-manifest.json */
  async getPrerenderManifest(): Promise<PrerenderManifest> {
    return JSON.parse(await readFile(join(this.publishDir, 'prerender-manifest.json'), 'utf-8'))
  }

  /**
   * Get Next.js middleware config from the build output
   */
  async getMiddlewareManifest(): Promise<MiddlewareManifest> {
    return JSON.parse(
      await readFile(join(this.publishDir, 'server/middleware-manifest.json'), 'utf-8'),
    )
  }

  // don't make private as it is handy inside testing to override the config
  _buildConfig: NextConfigComplete | null = null
  /** Get Next Config from build output **/
  get buildConfig(): NextConfigComplete {
    if (!this._buildConfig) {
      this._buildConfig = JSON.parse(
        readFileSync(join(this.publishDir, 'required-server-files.json'), 'utf-8'),
      ).config
    }
    return this._buildConfig as NextConfigComplete
  }

  /**
   * Get Next.js routes manifest from the build output
   */
  async getRoutesManifest(): Promise<RoutesManifest> {
    return JSON.parse(await readFile(join(this.publishDir, 'routes-manifest.json'), 'utf-8'))
  }

  /** Fails a build with a message and an optional error */
  failBuild(message: string, error?: unknown): never {
    return this.utils.build.failBuild(message, error instanceof Error ? { error } : undefined)
  }
}
