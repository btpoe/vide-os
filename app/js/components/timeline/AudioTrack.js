const AudioClip = require('./AudioClip');

module.exports = class AudioTrack extends React.Component {
    render() {
        const clips = this.props.clips.map((clip, i) =>
            React.createElement(AudioClip, Object.assign(clip, { zoom: this.props.zoom, key: i }))
        );

        return React.createElement(
            'div',
            {
                className: 'Timeline-track Timeline-track--audio'
            },
            clips
        );
    }
};
