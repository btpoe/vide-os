const { combineReducers } = require('redux');
const { ADD_CLIP } = require('./action-types');

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
        default:
            return state;
    }
}

function composition(state = initialComposition, action) {
    switch (action.type) {
        case ADD_CLIP:
            state = Object.assign({}, state, { clips: clips(state.clips, action) });
            state.duration += action.clip.duration;
            return state;
        default:
            return state;
    }
}

module.exports = combineReducers({
    composition
});
