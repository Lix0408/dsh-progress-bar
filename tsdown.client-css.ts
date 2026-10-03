import { readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { transform } from 'lightningcss'
import type { Plugin } from 'rolldown'

/** Virtual-module prefix, mirroring the official preset's `\0dsh-css:` marker. */
const VIRTUAL = '\0dsh-css:'
/**
 * Trailing marker keeping the virtual id out of CSS-plugin id filters. The
 * official preset uses the same trick (`<file>.module.css.mjs`); without it a
 * CSS-capable plugin claims the module first and parses our JS as CSS.
 */
const SUFFIX = '.mjs'

export interface DshCssModulesOptions {
  /** Owning package name; it becomes the `<style data-plugin>` marker. */
  pluginId: string
  /** Package root; the style tag id is the CSS path relative to it. */
  root: string
}

/**
 * Compile `*.module.css` into a JS module that injects its own `<style>`
 * element and exports the scoped class map.
 *
 * Self-contained replacement for the shared `clientBundle()` preset's CSS
 * handling: the host loads a single `client.js` per plugin, so the CSS has to
 * travel inside it rather than beside it.
 * @param options - owning package identity and root for style tag ids.
 * @returns the rolldown plugin.
 */
export function dshCssModules(options: DshCssModulesOptions): Plugin {
  return {
    name: 'dsh-css-modules',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const from = importer ?? process.cwd()
      const file = source.startsWith('.') ? resolve(dirname(from), source) : resolve(from, source)
      return VIRTUAL + file + SUFFIX
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null
      const file = id.slice(VIRTUAL.length, -SUFFIX.length)
      const { code, exports } = transform({
        filename: file,
        code: readFileSync(file),
        cssModules: true,
        minify: true,
      })
      const tagId = `${options.pluginId}/${relative(options.root, file).split(sep).join('/')}`
      // lightningcss returns the rich `{ name, composes, isReferenced }` shape;
      // the official artifacts export a flat `{ local: hashedName }` map.
      const classMap: Record<string, string> = {}
      for (const [local, entry] of Object.entries(exports ?? {})) classMap[local] = entry.name
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {`,
        `\tconst tag = document.createElement("style");`,
        `\ttag.dataset.plugin = ${JSON.stringify(options.pluginId)};`,
        `\ttag.dataset.pluginCss = tagId;`,
        `\ttag.textContent = css;`,
        `\tdocument.head.appendChild(tag);`,
        `}`,
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}
