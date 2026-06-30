/** @internal Formats a CTA block into the output metadata shape. */
export function formatCtaBlock(name, block) {
    if (!block || block.commands.length === 0)
        return undefined;
    return {
        description: block.description ??
            (block.commands.length === 1 ? 'Suggested command:' : 'Suggested commands:'),
        commands: block.commands.map((c) => formatCta(name, c)),
    };
}
/** @internal Formats a CTA by prefixing the CLI name. */
function formatCta(name, cta) {
    if (typeof cta === 'string')
        return { command: `${name} ${cta}` };
    const prefix = cta.command === name || cta.command.startsWith(`${name} `) ? '' : `${name} `;
    let cmd = `${prefix}${cta.command}`;
    if (cta.args)
        for (const [key, value] of Object.entries(cta.args))
            cmd += value === true ? ` <${key}>` : ` ${value}`;
    if (cta.options)
        for (const [key, value] of Object.entries(cta.options))
            cmd += value === true ? ` --${key} <${key}>` : ` --${key} ${value}`;
    return { command: cmd, ...(cta.description ? { description: cta.description } : undefined) };
}
//# sourceMappingURL=cta.js.map