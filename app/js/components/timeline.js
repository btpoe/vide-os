const Mousetrap = require('mousetrap');
const Tone = require('tone');
const { createStore } = require('redux');
const { Provider, connect } = require('react-redux');
const { addClip } = require('./timeline/actions');
const reducer = require('./timeline/reducers');
const VideoTrack = require('./timeline/VideoTrack');
const AudioTrack = require('./timeline/AudioTrack');
const Playhead = require('./timeline/Playhead');

const store = global.store = createStore(reducer);

class Composition extends React.Component {
    constructor() {
        super();

        this.state = {
            currentTime: 0,
            isDragging: false,
            isPlaying: false,
        };

        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
    }

    componentDidMount() {
        this.parentNode = this.refs.composition.parentNode;
        Mousetrap.bind('space', this.playPause.bind(this));
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

    get playhead() {
        return this.state.currentTime / this.props.zoom;
    }

    set currentTime(currentTime) {
        this.setState({ currentTime }, () => {
            global.eventHub.dispatchEvent(new CustomEvent('timelineProgress', {
                detail: { composition: this }
            }));
        });
    }

    getTimestamp(pageX) {
        return (pageX + this.parentNode.scrollLeft - this.parentNode.offsetLeft - 10) * this.props.zoom;
    }

    handleDragEnter() {
        this.setState({isDragging: true});
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.setState({dragData: { x: e.clientX, y: e.clientY }});
        return false;
    }

    handleDragLeave() {
        this.setState({isDragging: false});
    }

    handleDrop(e) {
        e.stopPropagation();

        const compositionStart = this.getTimestamp(e.pageX);

        const src = e.dataTransfer.getData('text/plain');
        const videoNode = document.createElement('video');
        videoNode.addEventListener('durationchange', () => {
            store.dispatch(addClip({
                src,
                videoNode,
                tracks: {
                    video: 1,
                    audio: 1
                },
                width: videoNode.naturalWidth,
                height: videoNode.naturalHeight,
                compositionStart,
                clipStart: 0,
                clipEnd: videoNode.duration * 1000,
                duration: videoNode.duration * 1000,
            }));
        });

        videoNode.src = src;

        return false;
    }

    render() {
        const { zoom } = this.props;

        const videoTracks = {
            1: { clips: [], zoom, key: 'video1' }
        };
        const audioTracks = {
            1: { clips: [], zoom, key: 'audio1' }
        };

        this.props.clips.forEach(clip => {
            if (clip.tracks.video) {
                if (!videoTracks[clip.tracks.video]) {
                    videoTracks[clip.tracks.video] = {
                        clips: [],
                        zoom,
                        key: `video${clip.tracks.video}`
                    };
                }
                videoTracks[clip.tracks.video].clips.push(clip);
            }
            if (clip.tracks.audio) {
                if (!audioTracks[clip.tracks.audio]) {
                    audioTracks[clip.tracks.audio] = {
                        clips: [],
                        zoom,
                        key: `audio${clip.tracks.audio}`
                    };
                }
                audioTracks[clip.tracks.audio].clips.push(clip);
            }
        });

        const tracks = (
            Object.keys(videoTracks).map(index =>
                React.createElement(VideoTrack, videoTracks[index])
            )
        ).concat(
            Object.keys(audioTracks).map(index =>
                React.createElement(AudioTrack, audioTracks[index])
            )
        );

        return React.createElement(
            'div',
            {
                ref: 'composition',
                className: `Timeline-composition ${this.state.isDragging ? 'is-dragging' : ''}`,
                style: {
                    width: `${this.props.duration/zoom}px`
                },
                onDragEnter: this.handleDragEnter,
                onDragOver: this.handleDragOver,
                onDragLeave: this.handleDragLeave,
                onDrop: this.handleDrop,
            },
            React.createElement(Playhead, { composition: this }),
            tracks
        );
    }
}

class Timeline extends React.Component {
    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline'
            },
            React.createElement(Composition, this.props.composition)
        );
    }
}

const ConnectedTimeline = connect(state => ({composition: state.composition}))(Timeline);

class WrapProvider extends React.Component {
    render() {
        return React.createElement(
            Provider,
            { store },
            React.createElement(ConnectedTimeline)
        )
    }
}

module.exports = WrapProvider;
