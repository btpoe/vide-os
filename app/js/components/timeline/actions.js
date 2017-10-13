const { ADD_CLIP, UPDATE_CLIP } = require('./action-types');

function addClip({ trackIdentity, src, start }) {
    return {
        type: ADD_CLIP,
        trackIdentity, src, start
    }
}

function updateClip(identity, payload) {
    const action = {
        type: UPDATE_CLIP,
        identity
    };

    ['start', 'offest', 'duration', 'end'].forEach(prop => {
        if (payload.hasOwnProperty(prop)) {
            action[prop] = payload[prop]
        }
    });

    return action;
}

module.exports = { addClip, updateClip };
