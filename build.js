// const browserSync = require('browser-sync');
const watch = require('node-watch');
const styles = require('./tasks/styles');
// const rollup = require('rollup');
// const rollupWatch = require('rollup-watch');
const rollupConfig = require('./rollup.config');

// browserSync.init({
//     server: 'build',
//     reloadDebounce: 2000,
//     open: false,
//     ghostMode: false
// });

// const watcher = rollupWatch(rollup, rollupConfig);
// watcher.on('event', event => {
//     if (event.code === 'BUILD_END') {
//         console.log(`scripts compiled, duration: ${event.duration}`);
//         browserSync.reload();
//     }
// });

watch('source/styles').on('change', styles.build);
styles.build();
