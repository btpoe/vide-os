const { combineReducers } = require('redux');
const { ADD_CLIP, UPDATE_CLIP } = require('./action-types');
const Sequence = require('../../classes/Sequence');

const sequence = global.rootSequence = new Sequence();

function clipActions(action) {
    switch (action.type) {
        case ADD_CLIP:
            const addedClip = sequence.getElementById(action.trackIdentity).addClipAtTime(action.src, action.start);
            addedClip.loaded.then(() => {
                global.store.dispatch({ type: null });
            });
            break;
        case UPDATE_CLIP:
            const updatedClip = sequence.getElementById(action.identity);
            ['start', 'offest', 'duration', 'end'].forEach(prop => {
                if (action.hasOwnProperty(prop)) {
                    updatedClip[prop] = action[prop]
                }
            });
            break;
        default:
            break;
    }
}

module.exports = combineReducers({
    sequence: (state, action) => {
        switch (action.type) {
            case ADD_CLIP:
            case UPDATE_CLIP:
                clipActions(action);
                break;
            default:
                break;
        }

        return sequence.toState();
    }
});
