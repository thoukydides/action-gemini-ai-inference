import _commonjs, { RollupCommonJSOptions } from '@rollup/plugin-commonjs';
import _typescript, { RollupTypescriptOptions } from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { Plugin, RollupLog, RollupOptions } from 'rollup';

// https://github.com/rollup/plugins/issues/1662
const commonjs = _commonjs as unknown as (options?: RollupCommonJSOptions) => Plugin;
const typescript = _typescript as unknown as (options?: RollupTypescriptOptions) => Plugin;

// https://github.com/rollup/rollup/issues/1089
const IGNORE_WARNINGS: Record<string, string[]> = {
    CIRCULAR_DEPENDENCY: ['@actions', 'zod'],
    THIS_IS_UNDEFINED:   ['@actions']
};
const onwarn = (warning: RollupLog, defaultHandler: (warning: string | RollupLog) => void): void => {
    const idIncludes = (s: string): boolean =>
        Boolean(warning.id?.includes(s)) || Boolean(warning.ids?.some(id => id.includes(s)));
    if (IGNORE_WARNINGS[warning.code ?? '']?.some(module => idIncludes(`/node_modules/${module}/`))) return;
    defaultHandler(warning);
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