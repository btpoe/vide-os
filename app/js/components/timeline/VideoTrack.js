const VideoClip = require('./VideoClip');
const { addClip } = require('./actions');

module.exports = class VideoTrack extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            isDragging: false,
        };

        this.handleDragOver = this.handleDragOver.bind(this);
        this.handleDragEnter = this.handleDragEnter.bind(this);
        this.handleDragLeave = this.handleDragLeave.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
    }

    handleDragEnter() {
        this.setState({ isDragging: true });
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.setState({ dragData: { x: e.clientX, y: e.clientY } });
        return false;
    }

    handleDragLeave() {
        this.setState({ isDragging: false });
    }

    handleDrop(e) {
        e.stopPropagation();

        global.store.dispatch(addClip({
            trackIdentity: this.props.identity,
            src: e.dataTransfer.getData('text/plain'),
            start: this.props.getTimestamp(e.pageX),
        }));

        this.setState({ isDragging: false });

        return false;
    }

    render() {
        return (
            React.createElement(
                'div',
                {
                    className: `Timeline-track Timeline-track--video ${this.state.isDragging ? 'is-dragging' : ''}`,
                    onDragOver: this.handleDragOver,
                    onDragEnter: this.handleDragEnter,
                    onDragLeave: this.handleDragLeave,
                    onDrop: this.handleDrop,
                },
                this.props.clips.map(clip =>
                    React.createElement(VideoClip, Object.assign(clip, { zoom: this.props.zoom, key: clip.identity }))
                )
            )
        );
    }
};
