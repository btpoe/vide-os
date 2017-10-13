const Draggable = require('react-draggable');

module.exports = props => React.createElement(
        Draggable,
        {
            axis: 'x',
            onStart: props.onStart,
            onDrag: props.onDrag,
            position: {x: props.x, y: 0}
        },
        React.createElement('div', {className: `Timeline-clipTrim Timeline-clipTrim--${props.type}`})
    );
