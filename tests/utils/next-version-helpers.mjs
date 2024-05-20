// @ts-check

import { readFile, writeFile } from 'node:fs/promises'

import fg from 'fast-glob'
import { valid, satisfies, gte } from 'semver'

const FUTURE_NEXT_PATCH_VERSION = '14.999.0'

const NEXT_VERSION_REQUIRES_REACT_19 = '14.3.0-canary.45'
// TODO: Update this when React 19 is released
const REACT_19_VERSION = '19.0.0-rc-3f1436cca1-20240516'
const REACT_18_VERSION = '18.2.0'

/**
 * Check if current next version satisfies a semver constraint
 * @param {string} condition Semver constraint
 * @returns {boolean} True if condition constraint is satisfied
 */
export function nextVersionSatisfies(condition) {
  const version = process.env.NEXT_RESOLVED_VERSION ?? process.env.NEXT_VERSION ?? 'latest'
  const isSemverVersion = valid(version)
  const checkVersion = isSemverVersion ? version : FUTURE_NEXT_PATCH_VERSION

  return satisfies(checkVersion, condition) || version === condition
}

/**
 * Check if current next version requires React 19
 * @param {string} version Next version
 * @returns {boolean} True if current next version requires React 19
 */

export function nextVersionRequiresReact19(version) {
  // @ts-expect-error Mistake in semver types
  return gte(version, NEXT_VERSION_REQUIRES_REACT_19, { includePrerelease: true })
}

/**
 * Finds all package.json in fixture directory and updates 'next' version to a given version
 * If there is test.dependencies.next, it will only update if the version satisfies the constraint in that field
 * @param {string} cwd Directory of a fixture
 * @param {string} version Version to which update 'next' version
 * @param {Object} [options] Update options
 * @param {string} [options.logPrefix] Text to prefix logs with
 * @param {'update' | 'revert'} [options.operation] This just informs log output wording, otherwise it has no effect
 * @param {boolean} [options.silent] Doesn't produce any logs if truthy
 * @param {boolean} [options.updateReact] Update React version to match Next version
 * @returns {Promise<void>}
 */
export async function setNextVersionInFixture(
  cwd,
  version,
  { logPrefix = '', operation = 'update', silent = false, updateReact = true } = {},
) {
  // use NEXT_RESOLVED_VERSION env var if exists and if passed version matches version from NEXT_VERSION
  // otherwise use whatever is passed
  const resolvedVersion =
    process.env.NEXT_RESOLVED_VERSION && (process.env.NEXT_VERSION ?? 'latest') === version
      ? process.env.NEXT_RESOLVED_VERSION
      : version

  // if resolved version is different from version, we add it to the log to provide additional details
  const nextVersionForLogs = `next@${version}${resolvedVersion !== version ? ` (${resolvedVersion})` : ``}`

  if (!silent) {
    console.log(
      `${logPrefix}▲ ${operation === 'revert' ? 'Reverting' : 'Updating'} to ${nextVersionForLogs}...`,
    )
  }

  const packageJsons = await fg.glob(['**/package.json', '!**/node_modules'], {
    cwd,
    absolute: true,
  })

  const isSemverVersion = valid(resolvedVersion)

  await Promise.all(
    packageJsons.map(async (packageJsonPath) => {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
      if (packageJson.dependencies?.next) {
        const versionConstraint = packageJson.test?.dependencies?.next
        // We can't use semver to check "canary" or "latest", so we use a fake future minor version
        const checkVersion = isSemverVersion ? resolvedVersion : FUTURE_NEXT_PATCH_VERSION
        if (
          operation === 'update' &&
          versionConstraint &&
          !satisfies(checkVersion, versionConstraint) &&
          version !== versionConstraint
        ) {
          if (!silent) {
            console.log(
              `${logPrefix}⏩ Skipping '${packageJson.name}' because it requires next@${versionConstraint}`,
            )
          }
          return
        }
        packageJson.dependencies.next = version
        if (updateReact && nextVersionRequiresReact19(checkVersion)) {
          const reactVersion = operation === 'update' ? REACT_19_VERSION : REACT_18_VERSION
          packageJson.dependencies.react = reactVersion
          packageJson.dependencies['react-dom'] = reactVersion
        }

        await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n')
      }
    }),
  )

  if (!silent) {
    console.log(
      `${logPrefix}▲ ${operation === 'revert' ? 'Reverted' : 'Updated'} to ${nextVersionForLogs}`,
    )
  }
}
