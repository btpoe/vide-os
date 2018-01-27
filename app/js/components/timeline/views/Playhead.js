const Draggable = require('react-draggable');
const Tone = require('tone');

module.exports = class Playhead extends React.Component {
    constructor() {
        super();

        this.state = {
            x: 0
        };

        this.handleDrag = this.handleDrag.bind(this);
        this.handleBarClick = this.handleBarClick.bind(this);
    }

    handleDrag(e, data) {
        const currentTime = data.x * this.props.sequence.state.zoom;
        this.props.sequence.currentTime = currentTime;
        Tone.Transport.seconds = currentTime / 1000;
    }

    handleBarClick(e) {
        const currentTime = this.props.sequence.getTimestamp(e.pageX);
        this.props.sequence.currentTime = currentTime;
        Tone.Transport.seconds = currentTime / 1000;

        const event = Object.assign({}, e.nativeEvent);
        event.target = event.srcElement = event.toElement = this.headNode;

        const context = this.draggableComponent._reactInternalFiber.child.stateNode;
        context.handleDragStart.call(context, event);
    }

    render() {
        return (
            React.createElement('div', { className: 'Timeline-playhead'},
                React.createElement('div', { className: 'Timeline-playhead-bar', onMouseDown: this.handleBarClick }),
                React.createElement(
                    Draggable, {
                        axis: 'x',
                        bounds: 'parent',
                        handle: '.Timeline-playhead-head',
                        onDrag: this.handleDrag,
                        position: {x: this.props.sequence.playhead, y: 0},
                        ref: (n) => { this.draggableComponent = n; }
                    },
                    React.createElement('div', { className: 'Timeline-playhead-line'},
                        React.createElement('div', { className: 'Timeline-playhead-head', ref: (n) => { this.headNode = n; } })
                    )
                )
            )
        )
    }
};
