const Draggable = require('react-draggable');

module.exports = class Playhead extends React.Component {
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
};
