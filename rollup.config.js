const nodeResolve = require('rollup-plugin-node-resolve');

module.exports = {
    entry: 'source/js/app.js',
    dest: 'app/js/app.js',
    format: 'iife',
    plugins: [ nodeResolve() ]
};
