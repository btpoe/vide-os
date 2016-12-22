const { ADD_CLIP, UPDATE_CLIP } = require('./action-types');

function addClip(clip) {
    return {
        type: ADD_CLIP,
        clip
    }
}

function updateClip(clipId, clipData) {
    return {
        type: UPDATE_CLIP,
        clipId,
        clipData
    }
}

module.exports = { addClip, updateClip };
