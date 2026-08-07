#!/usr/bin/env node
import * as Cli from './Cli.js';
declare const cli: Cli.Cli<{
    build: {
        args: {
            entry: string;
        };
        options: {
            installer?: boolean | undefined;
            name?: string | undefined;
            output?: string | undefined;
            repository?: string | undefined;
            tag?: string | undefined;
            target?: string[] | undefined;
            version?: string | undefined;
        };
    };
} & {
    gen: {
        args: {};
        options: {
            configSchema?: boolean | undefined;
            dir?: string | undefined;
            entry?: string | undefined;
            output?: string | undefined;
        };
    };
}, undefined, undefined, undefined>;
export default cli;
//# sourceMappingURL=bin.d.ts.map