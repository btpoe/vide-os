const { sortedIndexBy } = require('lodash');
const { find, indexOf } = require('../../../utils/binarySearch');
const AudioClip = require('./AudioClip');
const VideoClip = require('./VideoClip');

function clipAtTime(clip, time) {
    if (clip.start < time && clip.end > time) {
        return 0;
    }
    if (clip.start > time) {
        return -1;
    }
    return 1;
}

function clipInRange(clip, [startTime, endTime]) {
    if (clip.start < endTime && clip.end > startTime) {
        return 0;
    }
    if (clip.start > endTime) {
        return -1;
    }
    return 1;
}

class Track {
    constructor(parentNode, type) {
        this.parentNode = parentNode;
        this.type = type;
        this.clips = [];

        switch (type) {
            case Track.TYPE_AUDIO:
                this.ClipClass = AudioClip;
                break;
            case Track.TYPE_VIDEO:
                this.ClipClass = VideoClip;
                break;
        }
    }

    get loaded() {
        return Promise.all(this.clips.map(clip => clip.loaded));
    }

    get duration() {
        return this.clips.length ? this.clips[this.clips.length - 1].end : 0;
    }

    get index() {
        return this.parentNode[`${this.type}Tracks`].indexOf(this);
    }

    addClipAtTime(src, start, skipOverlapCheck = false) {
        const newClip = new this.ClipClass(this, src, start);
        this.parentNode.registerElement(newClip);

        newClip.loaded.then(() => {
            if (!skipOverlapCheck) {
                for (let clip of this.findClipsInRange(start, newClip.end)) {
                    if (clip.end > newClip.end) {
                        clip.split(newClip.end);
                    }

                    if (clip.start < start) {
                        clip.end = start;
                    } else {
                        this.removeClip(clip);
                    }
                }
            }

            const insertIndex = sortedIndexBy(this.clips, newClip, clip => clip.start);
            this.clips.splice(insertIndex, 0, newClip);
        });

        return newClip;
    }

    removeClip(clip) {
        return this.clips.splice(this.clips.indexOf(clip), 1);
    }

    findClipAtTime(time) {
        return find(clipAtTime, this.clips, time);
    }

    findClipsInRange(startTime, endTime) {
        const result = [];
        let index = indexOf(clipInRange, this.clips, [startTime, endTime]);

        if (index === -1) {
            return result;
        }

        while (index && this.clips[index - 1].end > startTime) {
            index--;
        }

        while (index < this.clips.length && this.clips[index].start < endTime) {
            result.push(this.clips[index]);
            index++;
        }

        return result;
    }

    render(time) {
        return new Promise((resolve) => {
            if (this.type !== Track.TYPE_VIDEO) {
                return resolve(false);
            }
            const videoClip = this.findClipAtTime(time);
            if (!videoClip) {
                return resolve(false);
            }
            videoClip.render(time).then(resolve);
        });
    }

    toState() {
        return {
            identity: this.identity,
            clips: this.clips.map(clip => clip.toState()),
        };
    }
}

Track.TYPE_VIDEO = 'video';
Track.TYPE_AUDIO = 'audio';

module.exports = Track;
