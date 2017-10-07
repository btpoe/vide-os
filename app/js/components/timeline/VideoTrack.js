const VideoClip = require('./VideoClip');

module.exports = props => {
    const clips = props.clips.map((clip, i) =>
        React.createElement(VideoClip, Object.assign(clip, { clipId: i, zoom: props.zoom, key: i }))
    );

    return React.createElement(
        'div',
        {
            className: 'Timeline-track Timeline-track--video'
        },
        clips
    )
};
