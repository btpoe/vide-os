const Clip = require('./Clip');

class VideoNode extends Clip {
    constructor(parentNode, src, start) {
        super(parentNode, src, start);

        this.player = document.createElement('video');
        this.dimensions = [0, 0];

        this.loaded = new Promise((resolve) => {
            this.player.addEventListener('durationchange', () => {
                this.width = this.player.naturalWidth;
                this.height = this.player.naturalHeight;
                this.duration = this.player.duration * 1000;
                resolve();
            });
        });

        this.player.src = src;
    }

    set width(value) {
        this.dimensions[0] = value;
    }

    get width() {
        return this.dimensions[0];
    }

    set height(value) {
        this.dimensions[1] = value;
    }

    get height() {
        return this.dimensions[1];
    }

    toState() {
        return {
            duration: this.duration,
            height: this.height,
            identity: this.identity,
            offset: this.offset,
            src: this.src,
            start: this.start,
            width: this.width,
        };
    }
}

VideoNode.load = (parentNode, { src, timing, dimensions }) => {
    const clip = new VideoNode(parentNode, src);
    clip.start = timing[0];
    clip.offset = timing[1];
    clip.duration = timing[2];
    clip.width = dimensions[0];
    clip.height = dimensions[1];
    return clip;
};

module.exports = VideoNode;
