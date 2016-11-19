const { createStore } = require('redux');
const { Provider, connect } = require('react-redux');
const { addClip } = require('./timeline/actions');
const reducer = require('./timeline/reducers');

const store = createStore(reducer);

class VideoClip extends React.Component {
    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline-clip Timeline-clip--video',
                style: {
                    width: `${this.props.duration/this.props.zoom}px`
                }
            },
            React.createElement('img', { src: 'http://placehold.it/50x50'})
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

class Composition extends React.Component {
    constructor() {
        super();

        this.state = {
            isDragging: false
        };

        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
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
        const { zoom } = this.props.zoom;

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

// const exampleClip = {
//     src: 'path/to/media',
//     tracks: {
//         video: 2,
//         audio: 1
//     },
//     startAt: 12341234,
//     clipStart: 231412423,
//     clipEnd: 12312341,
// };
