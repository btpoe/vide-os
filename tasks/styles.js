const fs = require('fs');
// const browserSync = require('browser-sync');
// const autoprefixer = require('autoprefixer');
// const cssnano = require('cssnano');
// const postcss = require('postcss');
const sass = require('node-sass');

module.exports.build = () => {
    sass.render({
        file: 'source/styles/app.scss',
        recursive: true
    }, (err, result) => {
        if (err) {
            console.log(err.message);
        } else {
            console.log(`styles compiled, duration: ${result.stats.duration}`);
            // browserSync.stream({ match: '**/*.css' });
            fs.writeFile('app/styles/app.css', result.css, (e, s) => {
                if (e) {
                    console.error(e);
                } else if (s) {
                    console.log(s);
                }
            });
            // postcss([autoprefixer, cssnano])
            //     .process(result.css)
            //     .then(res => {
            //         browserSync.stream({ match: '**/*.css' });
            //         fs.writeFile('build/styles/app.css', res.css);
            //     });
        }
    });
};
