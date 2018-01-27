const fs = require('fs');
const Tone = require('tone');
const drawWave = require('draw-wave');
const debounce = require('lodash.debounce');
const { updateClip } = require('../actions');

module.exports = class AudioClip extends React.Component {
    componentDidMount() {
        fs.readFile(this.props.src, (err, audioData) => {
            if (err) return;
            Tone.context.decodeAudioData(audioData.buffer).then(buffer => {
                this.rootNode.appendChild(drawWave.svg(buffer, 500, 300, '#52F6A4'));
            })
        });
    }

    componentWillReceiveProps(nextProps) {
        if (this.shouldUpdateAudioStart(nextProps)) {
            global.store.dispatch(updateClip(this.props.identity, {
                start: nextProps.start,
                offset: nextProps.offset,
                duration: nextProps.duration,
            }));
        }
    }

    shouldUpdateAudioStart(nextProps) {
        return (
            nextProps.start !== this.props.start
            ||
            nextProps.offset !== this.props.offset
            ||
            nextProps.duration !== this.props.duration
        );
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
                    transform: `translateX(${this.props.start/this.props.zoom}px)`
                }
            },
            React.createElement(
                'svg',
                {
                    ref: (n) => { this.rootNode = n; },
                    preserveAspectRatio: 'none',
                    viewBox: '0 0 500 300',
                    style: {
                        height: '100%',
                        marginLeft: `${-this.props.offset/this.props.zoom}px`,
                        width: `${this.props.duration/this.props.zoom}px`,
                    }
                }
            )
        );
    }
};
