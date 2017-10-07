const { ADD_CLIP, TRIM_CLIP, UPDATE_CLIP } = require('./action-types');

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

function trimClip(clipId, side, timestamp) {
    return {
        type: TRIM_CLIP,
        clipId, side, timestamp
    }
}

module.exports = { addClip, updateClip, trimClip };
