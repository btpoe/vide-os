const Mousetrap = require('mousetrap');
const Tone = require('tone');
const VideoTrack = require('./VideoTrack');
const AudioTrack = require('./AudioTrack');
const Playhead = require('./Playhead');
const cursor = require('../../services/cursor');

module.exports = class Sequence extends React.Component {
    constructor() {
        super();

        this.state = {
            currentTime: 0,
            isPlaying: false,
            zoom: 15,
        };

        cursor.listener = this;

        this.getTimestamp = this.getTimestamp.bind(this);
    }

    componentDidMount() {
        this.parentNode = this.rootNode.parentNode;
        Mousetrap.bind('space', this.playPause.bind(this));
        Mousetrap.bind('c', () => {
            cursor.state = cursor.STATE_CUT;
        });
        Mousetrap.bind('v', () => {
            cursor.state = cursor.STATE_DEFAULT;
        });
    }

    playPause() {
        this.setState({ isPlaying: !this.state.isPlaying }, () => {
            Tone.Transport[this.state.isPlaying ? 'start' : 'pause']();
            this.animationFrameTimestamp = performance.now();
            this.renderNextFrame();
        });
    }

    renderNextFrame() {
        if (this.state.isPlaying) {
            // do stuff
            const timeOffset = performance.now() - this.animationFrameTimestamp;
            const currentTime = this.state.currentTime + timeOffset;
            if (currentTime >= this.props.duration) {
                this.currentTime = this.props.duration;
                this.setState({ isPlaying: false });
            } else {
                this.animationFrameTimestamp = performance.now();
                this.currentTime = currentTime;
                requestAnimationFrame(this.renderNextFrame.bind(this));
            }
        }
    }

    getTimestamp(pageX) {
        return (pageX + this.parentNode.scrollLeft - this.parentNode.offsetLeft - 10) * this.state.zoom;
    }

    get playhead() {
        return this.state.currentTime / this.state.zoom;
    }

    set currentTime(currentTime) {
        this.setState({ currentTime }, () => {
            global.eventHub.dispatchEvent(new CustomEvent('timelineProgress', {
                detail: { sequence: this }
            }));
        });
    }

    render() {
        const { zoom } = this.state;

        const tracks = [
            ...this.props.videoTracks.map(({ clips, identity }) => (
                React.createElement(VideoTrack, {
                    clips,
                    identity,
                    zoom,
                    getTimestamp: this.getTimestamp,
                    key: identity,
                })
            )),
            ...this.props.audioTracks.map(({ clips, identity }) => (
                React.createElement(AudioTrack, {
                    clips,
                    identity,
                    zoom,
                    getTimestamp: this.getTimestamp,
                    key: identity,
                })
            ))
        ];

        return React.createElement(
            'div',
            {
                ref: (n) => { this.rootNode = n; },
                className: 'Timeline-sequence',
                style: {
                    width: `${this.props.duration/zoom}px`
                },
            },
            React.createElement(Playhead, { sequence: this }),
            tracks
        );
    }
};
