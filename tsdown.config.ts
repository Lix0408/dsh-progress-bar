import { defineConfig } from 'tsdown'
import { dshCssModules } from './tsdown.client-css.ts'

/** Package name: it becomes the browser module identity and the <style> marker. */
const PLUGIN_ID = 'dsh-progress-bar'

/**
 * Specifiers the host resolves from its shared module base (React and the
 * static UI table) or from another plugin's client row. They must stay
 * `require(...)` calls, never be bundled: the platform keeps one browser
 * identity per module.
 */
const NEVER_BUNDLE = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', /^@deepseek-ai\//]

export default defineConfig([
  // Node half: a Loader-visible row. `clean` stays off because both configs
  // share `lib/`; the build script removes it once, up front.
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: NEVER_BUNDLE, onlyBundle: false },
    dts: false,
    clean: false,
    sourcemap: false,
  },
  // Browser half: one CJS bundle wrapped in the host's module-loader closure.
  {
    name: `${PLUGIN_ID} (client)`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: NEVER_BUNDLE, onlyBundle: false },
    plugins: [dshCssModules({ pluginId: PLUGIN_ID, root: import.meta.dirname })],
    // The banner opens the factory and provides the CJS `module`/`exports`
    // pair the generated body assigns to; the footer returns the exports.
    banner: `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;`,
    footer: `\t\treturn module.exports;
\t}
});`,
    dts: false,
    clean: false,
    sourcemap: false,
  },
])
