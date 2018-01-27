const seeking = Symbol('seeking');

module.exports = class extends React.Component {
    constructor() {
        super();

        this.frameQueue = {};
        this.gcFrameQueueRate = 120;

        this.onTimelineProgress = this.onTimelineProgress.bind(this);
    }

    onTimelineProgress(e) {
        const comp = e.detail.sequence;
        const time = comp.currentTime;
        const promise = this.frameQueue[time];
        if (promise && promise.completed) {
            promise.then((ctx) => {
                if (ctx) {
                    this.previewContext.drawImage(ctx, 0, 0);
                }
            })
        }
        this.fillQueue(time, comp.props.fps);
    }

    fillQueue(time, fps) {
        delete this.frameQueue[time];
        let frameCount = 10;
        let nextFrame = time;
        while (frameCount--) {
            nextFrame += Math.round(1000 / fps);
            if (!this.frameQueue[nextFrame]) {
                this.frameQueue[nextFrame] = global.rootSequence.render(nextFrame);
            }
        }
        this.gcFrameQueue(time);
    }

    gcFrameQueue(time) {
        if (--this.gcFrameQueueRate) {
            return;
        }
        this.gcFrameQueueRate = 120;
        Object.keys(this.frameQueue).filter(frame => frame < time).forEach(frame => {
            delete this.frameQueue[frame];
        });
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
