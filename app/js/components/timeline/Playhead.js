const Draggable = require('react-draggable');

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
        this.props.composition.currentTime = data.x * this.props.composition.props.zoom;
    }

    handleBarClick(e) {
        this.props.composition.currentTime = this.props.composition.getTimestamp(e.pageX);
        const event = Object.assign({}, e.nativeEvent);
        const context = this.refs.draggable._reactInternalInstance._renderedComponent._instance;
        event.target = event.srcElement = event.toElement = this.refs.head;
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
                        position: {x: this.props.composition.playhead, y: 0},
                        ref: 'draggable'
                    },
                    React.createElement('div', { className: 'Timeline-playhead-line'},
                        React.createElement('div', { className: 'Timeline-playhead-head', ref: 'head' })
                    )
                )
            )
        )
    }
};
