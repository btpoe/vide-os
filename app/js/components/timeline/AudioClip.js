const Tone = require('tone');
const drawWave = require('draw-wave');
const debounce = require('lodash.debounce');

function getDuration(props) {
    return props.clipEnd - props.clipStart;
}

module.exports = class AudioClip extends React.Component {
    constructor(props) {
        super(props);

        this.setStart = debounce((compStart, clipStart, duration) => {
            console.log(duration);
            this.player.unsync().sync().start(compStart / 1000, clipStart / 1000, duration / 1000);
        }, 250);
    }
    componentDidMount() {
        this.player = new Tone.Player(this.props.src, () => {
            const waveSVG = drawWave.svg(this.player.buffer, 500, 300, '#52F6A4');
            this.rootNode.appendChild(waveSVG);
        }).toMaster();

        this.setStart(this.props.compositionStart, this.props.clipStart, getDuration(this.props));
    }

    componentWillReceiveProps(nextProps) {
        if (this.shouldUpdateAudioStart(nextProps)) {
            this.setStart(nextProps.compositionStart, nextProps.clipStart, getDuration(nextProps));
        }
    }

    shouldUpdateAudioStart(nextProps) {
        return (
            nextProps.compositionStart !== this.props.compositionStart
            ||
            nextProps.clipStart !== this.props.clipStart
            ||
            nextProps.clipEnd !== this.props.clipEnd
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
                    width: `${getDuration(this.props)/this.props.zoom}px`,
                    transform: `translateX(${this.props.compositionStart/this.props.zoom}px)`
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
                        marginLeft: `${-this.props.clipStart/this.props.zoom}px`,
                        width: `${this.props.duration/this.props.zoom}px`,
                    }
                }
            )
        );
    }
};
