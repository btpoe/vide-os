const { ADD_CLIP } = require('./action-types');

function addClip(clip) {
    return {
        type: ADD_CLIP,
        clip
    }
}

module.exports = { addClip };
