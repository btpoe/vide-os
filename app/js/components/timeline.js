const { createStore } = require('redux');
const { Provider, connect } = require('react-redux');
const reducer = require('./timeline/reducers');
const Sequence = require('./timeline/Sequence');

const store = global.store = createStore(reducer);

class Timeline extends React.Component {
    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline'
            },
            React.createElement(Sequence, this.props.sequence)
        );
    }
}

const ConnectedTimeline = connect(state => ({sequence: state.sequence}))(Timeline);

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
