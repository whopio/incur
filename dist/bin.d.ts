#!/usr/bin/env node
import * as Cli from './Cli.js';
declare const cli: Cli.Cli<{
    gen: {
        args: {};
        options: {
            configSchema?: boolean | undefined;
            dir?: string | undefined;
            entry?: string | undefined;
            output?: string | undefined;
        };
    };
}, undefined, undefined>;
export default cli;
//# sourceMappingURL=bin.d.ts.map