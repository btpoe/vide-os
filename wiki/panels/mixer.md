# Mixer

Per-track meters, mute and solo, plus a master meter.

---

## Layout

One strip per track — video tracks first, then audio tracks — and a Master strip
at the end. Each strip shows the track name, a pair of meters, and **M** and
**S** buttons.

| Control | What it does                                                 |
| ------- | ------------------------------------------------------------ |
| **M**   | Mute this track. Red when muted.                             |
| **S**   | Solo. Amber when soloed; every non-soloed track is silenced. |
| Meters  | Peak level during playback                                   |

Video tracks appear here because a video clip can carry audio (see
[Properties ▸ Audio](properties.md#audio)).

Mute is also available in the [timeline track header](timeline.md#the-track-header).
Solo is only here, because solo is a mix decision rather than a track property
you set while cutting.

## Reading the meters

| Colour | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| Green  | Normal                                                   |
| Amber  | Approaching full scale                                   |
| Red    | At or near full scale — this is what clipping looks like |

The scale is decibel-ish with a −48 dB floor, so quiet material still shows
movement rather than sitting flat at the bottom.

Meters read at 20 Hz rather than per animation frame. They only need to look
alive, and polling an analyser per track at 60 Hz is wasted work when the UI is
otherwise idle.

A track that is silent **because someone else is soloed** renders differently
from one you muted yourself — the distinction matters when you are trying to
work out why you cannot hear something.

## What is not here

- **No fader.** Track level is not a document property today; per-clip volume,
  pan and fades are in [Properties](properties.md#audio).
- **No master fader**, for the same reason.
- **No stereo separation in the display.** Both meters in a strip show the same
  peak value; the pair is visual, not left/right.

The audio graph itself does have per-track gain and pan nodes, so exposing
faders is wiring rather than architecture — see the [Roadmap](../roadmap.md).

## Why what you hear is what you get

The live mixer and the offline export mixdown call the **same function** to
build the audio graph, differing only in which context they are handed: an
`AudioContext` for playback, an `OfflineAudioContext` for export.

That is structural rather than aspirational. The export path used to be a
completely separate mixdown that was then played into a recorder _in real time_
while video rendered at render speed — it could not line up even in principle.

Source: `src/panels/MixerPanel.tsx`, `src/audio/graph.ts`,
`src/audio/engine.ts`, `src/audio/offline.ts`.

---

**See also:** [Properties ▸ Audio](properties.md#audio) ·
[Export](dialogs.md#export)
