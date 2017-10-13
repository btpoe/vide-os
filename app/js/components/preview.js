const seeking = Symbol('seeking');

module.exports = class extends React.Component {
    constructor() {
        super();

        this.onTimelineProgress = this.onTimelineProgress.bind(this);
    }

    onTimelineProgress(e) {
        const comp = e.detail.sequence;
        const clip = global.rootSequence.videoTracks[0].findClipAtTime(comp.state.currentTime);
        if (clip) {
            if (!clip.player[seeking]) {
                clip.player.currentTime = (clip.offset + comp.state.currentTime - clip.start) / 1000;
                clip.player[seeking] = true;
                const onSeeked = () => {
                    clip.player[seeking] = false;
                    this.onSeeked(clip);
                    clip.player.removeEventListener('seeked', onSeeked);
                };
                clip.player.addEventListener('seeked', onSeeked);
            }
        } else {
            const ctx = this.previewContext;
            ctx.beginPath();
            ctx.rect(0, 0, 1280, 720);
            ctx.fillStyle = "black";
            ctx.fill();
        }
    }

    onSeeked(clip) {
        this.previewContext.drawImage(clip.player, 0, 0, 1280, 720);
    }

    componentDidMount() {
        this.previewContext = this.canvasNode.getContext('2d');
        global.eventHub.addEventListener('timelineProgress', this.onTimelineProgress);
    }

    componentWillUnmount() {
        global.eventHub.removeEventListener('timelineProgress', this.onTimelineProgress);
    }

    render() {
        return (
            React.createElement(
                'div',
                {
                    className: 'Preview'
                },
                React.createElement(
                    'div',
                    {
                        className: 'Preview-viewport'
                    },
                    React.createElement(
                        'canvas',
                        {
                            ref: (n) => { this.canvasNode = n; },
                            width: 1280,
                            height: 720,
                        }
                    )
                )
            )
        );
    }
};
