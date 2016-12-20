const Mousetrap = require('mousetrap');
const Draggable = require('react-draggable');
const { createStore } = require('redux');
const { Provider, connect } = require('react-redux');
const { addClip } = require('./timeline/actions');
const reducer = require('./timeline/reducers');

const store = createStore(reducer);

const THUMB_SIZE = 50;

function same(obj1, obj2, prop) {
    if (Array.isArray(prop)) {
        return prop.every(p => obj1[p] === obj2[p]);
    }
    return obj1[prop] === obj2[prop];
}

class VideoClip extends React.Component {
    componentDidMount() {
        this.componentDidUpdate({});
    }

    componentDidUpdate(prevProps) {
        if (!same(this.props, prevProps, 'clipStart')) {
            this.refs.srcVideo.currentTime = this.props.clipStart / 1000;
        }
    }

    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline-clip Timeline-clip--video',
                style: {
                    width: `${this.props.duration/this.props.zoom}px`
                }
            },
            React.createElement('video', { ref: 'srcVideo', src: this.props.src, height: THUMB_SIZE })
        );
    }
}

class VideoTrack extends React.Component {
    render() {
        const clips = this.props.clips.map((clip, i) =>
            React.createElement(VideoClip, Object.assign(clip, { zoom: this.props.zoom, key: i }))
        );

        return React.createElement(
            'div',
            {
                className: 'Timeline-track Timeline-track--video'
            },
            clips
        );
    }
}

class AudioClip extends React.Component {
    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline-clip Timeline-clip--audio',
                style: {
                    width: `${this.props.duration/this.props.zoom}px`
                }
            },
            'aud clip'
        );
    }
}

class AudioTrack extends React.Component {
    render() {
        const clips = this.props.clips.map((clip, i) =>
            React.createElement(AudioClip, Object.assign(clip, { zoom: this.props.zoom, key: i }))
        );

        return React.createElement(
            'div',
            {
                className: 'Timeline-track Timeline-track--audio'
            },
            clips
        );
    }
}

class CompPlayhead extends React.Component {
    constructor() {
        super();

        this.state = {
            x: 0
        };

        this.handleDrag = this.handleDrag.bind(this);
    }

    handleDrag(e, data) {
        this.props.composition.currentTime = data.x * this.props.composition.props.zoom;
    }

    render() {
        return (
            React.createElement('div', { className: 'Timeline-playhead'},
                React.createElement(
                    Draggable, {
                        axis: 'x',
                        bounds: 'parent',
                        handle: '.Timeline-playhead-head',
                        onDrag: this.handleDrag,
                        position: {x: this.props.composition.playhead, y: 0}
                    },
                    React.createElement('div', { className: 'Timeline-playhead-line'},
                        React.createElement('div', { className: 'Timeline-playhead-head'})
                    )
                )
            )
        )
    }
}

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
        Mousetrap.bind('space', this.playPause.bind(this));
    }

    playPause() {
        this.setState({ isPlaying: !this.state.isPlaying }, () => {
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
                this.setState({
                    currentTime: this.props.duration,
                    isPlaying: false,
                });
            } else {
                this.animationFrameTimestamp = performance.now();
                this.setState({ currentTime });
                requestAnimationFrame(this.renderNextFrame.bind(this));
            }
        }
    }

    get playhead() {
        return this.state.currentTime / this.props.zoom;
    }

    set currentTime(currentTime) {
        this.setState({ currentTime });
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

        const src = e.dataTransfer.getData('text/plain');
        const vid = document.createElement('video');
        vid.addEventListener('durationchange', () => {
            store.dispatch(addClip({
                src,
                tracks: {
                    video: 1,
                    audio: 1
                },
                startAt: 0,
                clipStart: 0,
                duration: vid.duration * 1000
            }));
        });

        vid.src = src;

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
            React.createElement(CompPlayhead, { composition: this }),
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
