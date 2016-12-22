const { combineReducers } = require('redux');
const { ADD_CLIP, UPDATE_CLIP } = require('./action-types');

const initialComposition = {
    clips: [],
    frameRate: 30,
    duration: 10000,
    zoom: 15
};

function clips(state = [], action) {
    switch (action.type) {
        case ADD_CLIP:
            return state.slice().concat([action.clip]);
        case UPDATE_CLIP:
            state = state.slice();
            state[action.clipId] = Object.assign({}, state[action.clipId], action.clipData);
            return state;
        default:
            return state;
    }
}

function composition(state = initialComposition, action) {
    switch (action.type) {
        case ADD_CLIP:
        case UPDATE_CLIP:
            state = Object.assign({}, state, { clips: clips(state.clips, action) });
            state.duration = _(state.clips).map(clip => clip.compositionStart + clip.duration).max() + 1000;
            return state;
        default:
            return state;
    }
}

module.exports = combineReducers({
    composition
});
