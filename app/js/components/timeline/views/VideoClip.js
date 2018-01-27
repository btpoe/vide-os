const Draggable = require('react-draggable');
const { updateClip } = require('../actions');
const cursor = require('../../../services/cursor');
const { same } = require('../../../utils');
// const ClipTrim = require('./ClipTrim');
const THUMB_SIZE = 50;

module.exports = class VideoClip extends React.Component {
    constructor() {
        super();

        this.handleDrag = this.handleDrag.bind(this);
        // this.handleTrimStart = this.handleTrimStart.bind(this);
        // this.handleStartTrimDrag = this.handleTrimDrag('start');
        // this.handleEndTrimDrag = this.handleTrimDrag('end');
    }

    componentDidMount() {
        this.componentDidUpdate({});
    }

    componentDidUpdate(prevProps) {
        if (!same(this.props, prevProps, 'offset')) {
            this.videoNode.currentTime = this.props.offset / 1000;
        }
    }

    handleDrag(e, data) {
        global.store.dispatch(updateClip(this.props.identity, { start: data.x * this.props.zoom }));
    }

    // handleTrimStart(e) {
    //     e.stopPropagation();
    //     this.trimClipStart = this.props.offset;
    //     this.trimClipEnd = this.props.duration;
    // }

    // handleTrimDrag(side) {
    //     return (e, data) => {
    //         let timestamp = this.props.offset + (data.x * this.props.zoom);
    //         offset = Math.clamp(offset, 0, this.props.duration);
    //         global.store.dispatch(trimClip(this.props.identity, {
    //             side,
    //             offset
    //         }));
    //     }
    // }

    render() {
        const x = this.props.start / this.props.zoom;

        return React.createElement(
            Draggable,
            {
                axis: 'x',
                bounds: 'parent',
                cancel: '.Timeline-clipTrim',
                disabled: cursor.state !== cursor.STATE_DEFAULT,
                onDrag: this.handleDrag,
                position: {x, y: 0}
            },
            React.createElement(
                'div',
                {
                    className: 'Timeline-clip Timeline-clip--video',
                    style: {
                        width: `${this.props.duration / this.props.zoom}px`,
                    }
                },
                React.createElement('video', { ref: (n) => { this.videoNode = n; }, src: this.props.src, height: THUMB_SIZE })//,
                // React.createElement(
                //     ClipTrim,
                //     {
                //         disabled: cursor.state !== cursor.STATE_DEFAULT,
                //         onDrag: this.handleStartTrimDrag,
                //         onStart: this.handleTrimStart,
                //         type: 'start',
                //         x: 0,
                //     }
                // ),
                // React.createElement(
                //     ClipTrim,
                //     {
                //         disabled: cursor.state !== cursor.STATE_DEFAULT,
                //         onDrag: this.handleEndTrimDrag,
                //         onStart: this.handleTrimStart,
                //         type: 'end',
                //         x: this.props.duration / this.props.zoom,
                //     }
                // )
            )
        );
    }
};
