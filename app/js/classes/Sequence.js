const Track = require('./Track');

class Sequence {
    constructor() {
        this.videoTracks = [new Track(this, Track.TYPE_VIDEO)];
        this.audioTracks = [new Track(this, Track.TYPE_AUDIO)];
        this.elements = {};
        this.frameRate = 30;
        this.nextElementIdentity = 0;

        this.registerElement(this.videoTracks[0]);
        this.registerElement(this.audioTracks[0]);
    }

    get duration() {
        return Math.max(
            10000,
            ...this.videoTracks.map(track => track.duration),
            ...this.audioTracks.map(track => track.duration)
        )
    }

    get loaded() {
        return Promise.all([
            ...this.videoTracks.map(track => track.loaded),
            ...this.audioTracks.map(track => track.loaded)
        ]);
    }

    newTrack(type) {
        const track = new Track(this, type);
        this[`${type}Tracks`].push(track);
        this.registerElement(track);
        return track;
    }

    registerElement(element) {
        element.identity = this.nextElementIdentity;
        this.elements[this.nextElementIdentity] = element;
        this.nextElementIdentity++;
    }

    getElementById(identity) {
        return this.elements[identity];
    }

    save() {
        return {
            videoTracks: this.videoTracks.map(track => track.save()),
            audioTracks: this.audioTracks.map(track => track.save()),
            frameRate: this.frameRate,
            nextIdentity: this.nextIdentity,
        }
    }

    toState() {
        return {
            videoTracks: this.videoTracks.map(track => track.toState()),
            audioTracks: this.audioTracks.map(track => track.toState()),
            frameRate: this.frameRate,
            duration: this.duration,
        }
    }
}

Sequence.load = ({
    videoTracks,
    audioTracks,
    frameRate,
    nextIdentity
}) => {
    const sequence = new Sequence();
    sequence.frameRate = frameRate;
    sequence.nextIdentity = nextIdentity;
    sequence.videoTracks = videoTracks.map(track => Track.load(track));
    sequence.audioTracks = audioTracks.map(track => Track.load(track));
    return sequence;
};

module.exports = Sequence;
