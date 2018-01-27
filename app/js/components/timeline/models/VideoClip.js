const Clip = require('./Clip');

const seeking = Symbol('seeking');

// TODO: make this dynamic;
const FPS = 30;

class VideoClip extends Clip {
    constructor(parentNode, src, start) {
        super(parentNode, src, start);

        this.player = document.createElement('video');
        this.fileName = this.src.slice(this.src.lastIndexOf('/') + 1);
        this.renderedFrames = {};
        this.dimensions = [0, 0];

        this.loaded = new Promise((resolve) => {
            const onProgress = () => {
                this.player.removeEventListener('progress', onProgress);

                this.width = this.player.videoWidth;
                this.height = this.player.videoHeight;
                this.duration = Math.round(this.player.duration * 1000);

                if (this.player.webkitAudioDecodedByteCount > 0) {
                    global.rootSequence.audioTracks[this.parentNode.index].addClipAtTime(this.src, this.start).loaded.then((linkedAudioClip) => {
                        this.link(linkedAudioClip);
                        resolve(this);
                    });
                } else {
                    resolve(this);
                }

                const cnvs = document.createElement('canvas');
                cnvs.width = this.width;
                cnvs.height = this.height;
                const ctx = cnvs.getContext('2d');

                const onSeeked = () => {
                    ctx.drawImage(this.player, 0, 0);

                    this.renderedFrames[Math.round(this.player.currentTime * 1000)] = ctx.getImageData(0, 0, this.width, this.height);
                    if (this.player.currentTime * 1000 < this.duration) {
                        this.player.currentTime += Math.round(1000 / FPS) / 1000;
                    } else {
                        this.player.removeEventListener('seeked', onSeeked);
                    }
                };

                this.player.addEventListener('seeked', onSeeked);
                this.player.currentTime = 0;
            };

            this.player.addEventListener('progress', onProgress);
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

    render(time) {
        let targetTime = this.offset + time - this.start;
        const frameTimeSpan = Math.round(1000 / FPS);
        let frameCount = Math.floor(targetTime / frameTimeSpan);
        const remainingTime = targetTime % frameTimeSpan;
        if (Math.round(remainingTime / frameTimeSpan)) {
            frameCount++;
        }
        const frame = Math.clamp(0, frameCount * frameTimeSpan, this.duration);
        return new Promise((resolve) => {
            const canvasNode = document.createElement('canvas');
            canvasNode.width = this.width;
            canvasNode.height = this.height;
            const ctx = canvasNode.getContext('2d');
            ctx.putImageData(this.renderedFrames[frame], 0, 0);
            resolve(canvasNode);
        });
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

VideoClip.load = (parentNode, { src, timing, dimensions }) => {
    const clip = new VideoClip(parentNode, src);
    clip.start = timing[0];
    clip.offset = timing[1];
    clip.duration = timing[2];
    clip.width = dimensions[0];
    clip.height = dimensions[1];
    return clip;
};

module.exports = VideoClip;
