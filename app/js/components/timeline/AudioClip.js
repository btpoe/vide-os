const Tone = require('tone');

module.exports = class AudioClip extends React.Component {
    componentDidMount() {
        this.player = new Tone.Player("./path/to/sample.mp3").toMaster();
    }

    componentWillUnmount() {
        this.player.disconnect();
    }

    render() {
        return React.createElement(
            'div',
            {
                className: 'Timeline-clip Timeline-clip--audio',
                style: {
                    width: `${this.props.duration/this.props.zoom}px`,
                    transform: `translateX(${this.props.compositionStart/this.props.zoom}px)`
                }
            },
            'aud clip'
        );
    }
};
