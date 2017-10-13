const cursor = require('../services/cursor');

module.exports = class Tools extends React.Component {
    constructor(props) {
        super(props);

        this.state = {};

        cursor.listener = this;

        this.handleSetCursorDefault = this.handleSetCursor(cursor.STATE_DEFAULT);
        this.handleSetCursorCut = this.handleSetCursor(cursor.STATE_CUT);
    }

    handleSetCursor(state) {
        return () => {
            cursor.state = state;
        };
    }

    render() {
        return React.createElement(
            'div',
            { className: 'Tools' },
            React.createElement(
                'button',
                {
                    type: 'button',
                    onClick: this.handleSetCursorDefault,
                    className: cursor.state === cursor.STATE_DEFAULT ? 'is-active' : null
                },
                'move'
            ),
            React.createElement(
                'button',
                {
                    type: 'button',
                    onClick: this.handleSetCursorCut,
                    className: cursor.state === cursor.STATE_CUT ? 'is-active' : null
                },
                'cut'
            )
        );
    }
};
