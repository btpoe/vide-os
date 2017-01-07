const _ = require('lodash');
const { exec, execSync } = require('child_process');
const svgo = require('svgo');
const options = require('../.sketchtoolrc.json');

const truthy = val => val && ['yes', 'true', '1', true, 1].includes(val.toLowerCase());

const args = [];

if (options.export) {
    args.push('export', options.export);
}

args.push(options.src);

[
    'output',
    'trimmed',
    'compression',
    'scales',
    'formats',
    'item',
    'items',
    'background',
    'bounds'
].forEach(key => {
    if (options[key]) {
        args.push(`--${key}=${options[key]}`);
    }
});

[
    'progressive',
    'compact',
    'group-contents-only',
    'save-for-web'
].forEach(key => {
    if (truthy(options[_.camelCase(key)])) {
        args.push(`--${key}`);
    }
});

const sketchtool = execSync('which sketchtool', { shell: '/bin/bash' }).toString().trim();
if (sketchtool) {
    args.unshift(sketchtool);
}

module.exports.build = () => {
    if (sketchtool) {
        const bundleExec = process.hrtime();

        exec(args.join(' '), { shell: '/bin/bash' }, (err, out, msg) => {
            if (err) {
                console.log(msg);
            } else {
                if (options.svgOptimize) {
                    execSync(`./node_modules/svgo/bin/svgo -f ${options.output}`, { shell: '/bin/bash' });
                }
                const diff = process.hrtime(bundleExec);
                console.log(`icons compiled, duration: ${ diff[0] * 1000 + Math.round(diff[1] / 1000000) }ms`);
            }
        });
    }
};
