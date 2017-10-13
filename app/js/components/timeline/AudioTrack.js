const AudioClip = require('./AudioClip');

module.exports = class AudioTrack extends React.Component {
    render() {
        return (
            React.createElement(
                'div',
                {
                    className: 'Timeline-track Timeline-track--audio'
                },
                this.props.clips.map((clip) =>
                    React.createElement(AudioClip, Object.assign(clip, { zoom: this.props.zoom, key: clip.identity }))
                )
            )
        );
    }
};
