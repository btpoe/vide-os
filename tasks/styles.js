const fs = require('fs');
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
            fs.writeFile('app/styles/app.css', result.css, (e, s) => {
                if (e) {
                    console.error(e);
                } else if (s) {
                    console.log(s);
                }
            });
        }
    });
};
