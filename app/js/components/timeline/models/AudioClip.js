const debounce = require('lodash.debounce');
const Tone = require('tone');
const Clip = require('./Clip');

class AudioClip extends Clip {
    constructor(parentNode, src, start) {
        super(parentNode, src, start);

        this.loaded = new Promise((resolve) => {
            this.player = new Tone.Player(src, () => {
                this.duration = this.player.buffer.duration * 1000;
                resolve(this);
            }).toMaster().sync();
            this.player.retrigger = true;
        });

        this.scheduledId = null;

        this._reschedule = debounce(() => {
            if (Number.isInteger(this.scheduledId)) {
                Tone.Transport.clear(this.scheduledId);
                this.player._scheduled.splice(this.player._scheduled.indexOf(this.scheduledId), 1);
            }

            this.player.start(this.start / 1000, this.offset / 1000, this.duration / 1000);
            this.scheduledId = this.player._scheduled[this.player._scheduled.length - 1];
        }, 250);
    }

    reschedule() {
        this._reschedule();
    }

    toState() {
        return {
            duration: this.duration,
            identity: this.identity,
            offset: this.offset,
            src: this.src,
            start: this.start,
        };
    }
}

AudioClip.load = (parentNode, { src, timing }) => {
    const clip = new AudioClip(parentNode, src, timing[0]);
    clip.offset = timing[1];
    clip.duration = timing[2];
    return clip;
};

module.exports = AudioClip;
