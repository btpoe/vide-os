const watch = require('node-watch');
const icons = require('./tasks/icons');
const argv = require('yargs')
    .array('only')
    .default('only', ['all'])
    .argv;

const run = key => argv.only.includes('all') || argv.only.includes(key);

if (run('icons')) {
    icons.build();

    if (argv.watch) {
        watch('source/icons').on('change', icons.build);
    }
}
