const listeners = new Set();

module.exports = {
    STATE_DEFAULT: 'STATE_DEFAULT',
    STATE_CUT: 'STATE_CUT',
    STATE_STRETCH: 'STATE_STRETCH',
    STATE_PAN: 'STATE_PAN',
    STATE_TWO_SIDED_SHIFT: 'STATE_TWO_SIDED_SHIFT',
    STATE_PUSH: 'STATE_PUSH',

    set listener(component) {
        listeners.add(component);
        component.state.cursorState = this.state;
    },

    set state(cursorState) {
        this._state = cursorState;
        listeners.forEach(listener => {
            listener.setState({ cursorState });
        });
    },

    get state() {
        return this._state || this.STATE_DEFAULT;
    },
};
