const seeking = Symbol('seeking');

module.exports = class extends React.Component {
    constructor() {
        super();

        this.onTimelineProgress = this.onTimelineProgress.bind(this);
    }

    onTimelineProgress(e) {
        const comp = e.detail.composition;
        const clips = comp.props.clips;
        const clip = clips.filter(clip => comp.state.currentTime > clip.compositionStart && comp.state.currentTime < clip.compositionStart + clip.duration)[0];
        if (clip) {
            if (!clip.videoNode[seeking]) {
                clip.videoNode.currentTime = (clip.clipStart + comp.state.currentTime - clip.compositionStart) / 1000;
                clip.videoNode[seeking] = true;
                const onSeeked = () => {
                    clip.videoNode[seeking] = false;
                    this.onSeeked(clip);
                    clip.videoNode.removeEventListener('seeked', onSeeked);
                };
                clip.videoNode.addEventListener('seeked', onSeeked);
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
        this.previewContext.drawImage(clip.videoNode, 0, 0);
    }

    componentDidMount() {
        this.previewContext = this.refs.preview.getContext('2d');
        global.eventHub.addEventListener('timelineProgress', this.onTimelineProgress);
    }

    componentWillUnmount() {
        global.eventHub.removeEventListener('timelineProgress', this.onTimelineProgress);
    }

    render() {
        return React.createElement('div', { style: { position: 'relative', paddingBottom: '56.25%', height: 0, backgroundColor: '#000' } },
            React.createElement('canvas', { ref: 'preview', width: 1280, height: 720, style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' } })
        );
    }
};
