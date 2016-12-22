const Draggable = require('react-draggable');
const { updateClip } = require('./actions');
const { same } = require('../../utils');
const THUMB_SIZE = 50;

module.exports = class VideoClip extends React.Component {
    constructor() {
        super();

        this.handleDrag = this.handleDrag.bind(this);
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

    render() {
        return React.createElement(
            Draggable,
            {
                axis: 'x',
                bounds: 'parent',
                onDrag: this.handleDrag,
                position: {x: this.props.compositionStart / this.props.zoom, y: 0}
            },
            React.createElement(
                'div',
                {
                    className: 'Timeline-clip Timeline-clip--video',
                    style: {
                        width: `${this.props.duration / this.props.zoom}px`,
                    }
                },
                React.createElement('video', { ref: 'srcVideo', src: this.props.src, height: THUMB_SIZE })
            )
        );
    }
};
