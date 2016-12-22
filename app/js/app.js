const AudioMeter = require('./components/audio-meter');
const Effects = require('./components/effects');
const EffectControls = require('./components/effect-controls');
const Media = require('./components/media');
const Preview = require('./components/preview');
const Timeline = require('./components/timeline');
const Tools = require('./components/tools');

global.eventHub = document.createElement('div');

const layout = new GoldenLayout({
    settings: {
        showPopoutIcon: false
    },
    content: [
        {
            type: 'column',
            content: [
                {
                    type: 'row',
                    height: 55,
                    content: [
                        {
                            type: 'react-component',
                            component: 'Media',
                            title: 'Media',
                            props: {},
                            width: 27
                        },
                        {
                            type: 'stack',
                            width: 28,
                            content: [
                                {
                                    type: 'react-component',
                                    component: 'Effects',
                                    title: 'Effects',
                                    props: {},
                                },
                                {
                                    type: 'react-component',
                                    component: 'EffectControls',
                                    title: 'EffectControls',
                                    props: {},
                                }
                            ]
                        },
                        {
                            type: 'react-component',
                            component: 'Preview',
                            title: 'Preview',
                            props: {},
                            width: 45
                        }
                    ]
                },
                {
                    type: 'row',
                    height: 45,
                    content: [
                        {
                            type: 'react-component',
                            component: 'Tools',
                            title: 'Tools',
                            props: {},
                            width: 8
                        },
                        {
                            type: 'react-component',
                            component: 'Timeline',
                            title: 'Timeline',
                            props: {},
                            width: 84
                        },
                        {
                            type: 'react-component',
                            component: 'AudioMeter',
                            title: 'AudioMeter',
                            props: {},
                            width: 8
                        }
                    ]
                }
            ]
        }
    ]
}, document.getElementById('AppRoot'));

layout.registerComponent('AudioMeter', AudioMeter);
layout.registerComponent('Effects', Effects);
layout.registerComponent('EffectControls', EffectControls);
layout.registerComponent('Media', Media);
layout.registerComponent('Preview', Preview);
layout.registerComponent('Timeline', Timeline);
layout.registerComponent('Tools', Tools);

layout.init();
