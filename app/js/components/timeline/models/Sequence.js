const Track = require('./Track');

class Sequence {
    constructor() {
        this.videoTracks = [];
        this.audioTracks = [];
        this.elements = {};
        this.fps = 30;
        this.nextElementIdentity = 0;

        this.newTrack(Track.TYPE_VIDEO);
        this.newTrack(Track.TYPE_AUDIO);
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

    render(time) {
        const promise = Promise.all(this.videoTracks.map(track => track.render(time)))
            .then(canvases => {
                promise.completed = true;
                canvases = canvases.filter(Boolean);
                if (!canvases.length) {
                    return false;
                }
                return canvases.reduce((canvas, image) => {
                    canvas.getContext('2d').drawImage(image, 0, 0, 1280, 720);
                    return canvas;
                })
            });

        return promise;
    }

    save() {
        return {
            videoTracks: this.videoTracks.map(track => track.save()),
            audioTracks: this.audioTracks.map(track => track.save()),
            fps: this.fps,
            nextIdentity: this.nextIdentity,
        }
    }

    toState() {
        return {
            videoTracks: this.videoTracks.map(track => track.toState()),
            audioTracks: this.audioTracks.map(track => track.toState()),
            fps: this.fps,
            duration: this.duration,
        }
    }
}

Sequence.load = ({
    videoTracks,
    audioTracks,
    fps,
    nextIdentity
}) => {
    const sequence = new Sequence();
    sequence.fps = fps;
    sequence.nextIdentity = nextIdentity;
    sequence.videoTracks = videoTracks.map(track => Track.load(track));
    sequence.audioTracks = audioTracks.map(track => Track.load(track));
    return sequence;
};

module.exports = Sequence;
