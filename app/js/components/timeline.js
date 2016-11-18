class VideoClip extends React.Component {
    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline-clip Timeline-clip--video'
            },
            'vid clip'
        );
    }
}

class VideoTrack extends React.Component {
    render() {
        const clips = this.props.clips.map((clip, i) =>
            React.createElement(VideoClip, Object.assign(clip, { key: i }))
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
                className: 'Timeline-clip Timeline-clip--audio'
            },
            'aud clip'
        );
    }
}

class AudioTrack extends React.Component {
    render() {
        const clips = this.props.clips.map((clip, i) =>
            React.createElement(AudioClip, Object.assign(clip, { key: i }))
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
            clips: [],
            duration: 10000,
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

        const clips = this.state.clips.slice();
        clips.push({
            src: e.dataTransfer.getData('text/plain'),
            tracks: {
                video: 1,
                audio: 1
            },
            startAt: 0,
            clipStart: 0
        });

        this.setState({ clips });
        return false;
    }

    render() {
        const videoTracks = {
            1: { clips: [], key: 'video1' }
        };
        const audioTracks = {
            1: { clips: [], key: 'audio1' }
        };

        this.state.clips.forEach(clip => {
            if (clip.tracks.video) {
                if (!videoTracks[clip.tracks.video]) {
                    videoTracks[clip.tracks.video] = {
                        clips: [],
                        key: `video${clip.tracks.video}`
                    };
                }
                videoTracks[clip.tracks.video].clips.push(clip);
            }
            if (clip.tracks.audio) {
                if (!audioTracks[clip.tracks.audio]) {
                    audioTracks[clip.tracks.audio] = {
                        clips: [],
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
                    width: `${this.state.duration}px`
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
    constructor() {
        super();
        this.state = {
            zoom: 1,
            composition: {
                clips: [],
                duration: 10000
            }
        };
    }

    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline'
            },
            React.createElement(Composition, this.state.composition)
        );
    }
}

module.exports = Timeline;

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
