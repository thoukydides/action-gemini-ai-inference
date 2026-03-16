import _commonjs, { RollupCommonJSOptions } from '@rollup/plugin-commonjs';
import _typescript, { RollupTypescriptOptions } from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { Plugin, RollupLog, RollupOptions } from 'rollup';

// https://github.com/rollup/plugins/issues/1662
const commonjs = _commonjs as unknown as (options?: RollupCommonJSOptions) => Plugin;
const typescript = _typescript as unknown as (options?: RollupTypescriptOptions) => Plugin;

// https://github.com/rollup/rollup/issues/1089
const onwarn = (warning: RollupLog, defaultHandler: (warning: string | RollupLog) => void): void => {
    const ids = [...(warning.ids ?? []), ...(warning.id ? [warning.id] : [])];
    if (ids.some(p => p.includes('/node_modules/@actions/') || p.includes('/node_modules/zod/'))
        && ['CIRCULAR_DEPENDENCY', 'THIS_IS_UNDEFINED'].includes(warning.code ?? '')) {
        // Suppress undefined this and circular dependency warnings for @actions/* and zod
    } else {
        console.log(JSON.stringify({ ids, code: warning.code }));
        defaultHandler(warning);
    }
};

const config: RollupOptions = {
    input: 'src/index.ts',
    output: {
        file: 'dist/index.js',
        format: 'cjs',
        sourcemap: true,
        exports: 'auto'
    },
    plugins: [
        typescript(),
        nodeResolve({ preferBuiltins: true, browser: false }),
        commonjs({
            transformMixedEsModules: true,
            requireReturnsDefault: 'auto'
        })
    ],
    onwarn
};

export default config;