const Draggable = require('react-draggable');
const { updateClip, trimClip } = require('./actions');
const { same } = require('../../utils');
const ClipTrim = require('./ClipTrim');
const THUMB_SIZE = 50;

module.exports = class VideoClip extends React.Component {
    constructor() {
        super();

        this.handleDrag = this.handleDrag.bind(this);
        this.handleTrimStart = this.handleTrimStart.bind(this);
        this.handleStartTrimDrag = this.handleTrimDrag('start');
        this.handleEndTrimDrag = this.handleTrimDrag('end');
    }

    componentDidMount() {
        this.componentDidUpdate({});
    }

    componentDidUpdate(prevProps) {
        if (!same(this.props, prevProps, 'clipStart')) {
            this.refs.srcVideo.currentTime = this.props.clipStart / 1000;
        }
    }

    handleDrag(e, data) {
        global.store.dispatch(updateClip(this.props.clipId, { compositionStart: data.x * this.props.zoom }));
    }

    handleTrimStart(e) {
        e.stopPropagation();
        this.trimClipStart = this.props.clipStart;
        this.trimClipEnd = this.props.clipEnd;
    }

    handleTrimDrag(side) {
        return (e, data) => {
            let timestamp = this.props.clipStart + (data.x * this.props.zoom);
            timestamp = Math.clamp(timestamp, 0, this.props.duration);
            global.store.dispatch(trimClip(this.props.clipId, side, timestamp));
        }
    }

    get currentDuration() {
        return this.props.clipEnd - this.props.clipStart;
    }

    render() {
        const x = this.props.compositionStart / this.props.zoom;
        return React.createElement(
            Draggable,
            {
                axis: 'x',
                bounds: 'parent',
                cancel: '.Timeline-clipTrim',
                onDrag: this.handleDrag,
                position: {x, y: 0}
            },
            React.createElement(
                'div',
                {
                    className: 'Timeline-clip Timeline-clip--video',
                    style: {
                        width: `${this.currentDuration / this.props.zoom}px`,
                    }
                },
                React.createElement('video', { ref: 'srcVideo', src: this.props.src, height: THUMB_SIZE }),
                React.createElement(
                    ClipTrim,
                    {
                        type: 'start',
                        x: 0,
                        handleStart: this.handleTrimStart,
                        handleDrag: this.handleStartTrimDrag
                    }
                ),
                React.createElement(
                    ClipTrim,
                    {
                        type: 'end',
                        x: this.currentDuration / this.props.zoom,
                        handleStart: this.handleTrimStart,
                        handleDrag: this.handleEndTrimDrag
                    }
                )
            )
        )
    }
};
