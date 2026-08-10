# Introduction

> A video editor you can read, change, and keep.

---

## What VideOS is

VideOS is a non-linear video editor built entirely on web standards. It decodes
with WebCodecs, composites with WebGL2, mixes with Web Audio, and reads your
files through the File System Access API. There is no server, no upload, no
account, and no render farm. Your media never leaves your machine.

It runs in a Chromium-based browser today. A Tauri desktop shell is the next
major phase, and the codebase is already built against a platform boundary that
makes it a port rather than a rewrite.

The target is a **solid creator NLE**: frame-accurate playback, deterministic
export, real timeline navigation, multi-track audio and video with per-clip
volume, pan and fades, transform and crop, titles, transitions, keyframed
effects, retiming, markers, and subtitles. That is a specific, achievable
target, and most of it is delivered.

## Who it is for

People who edit video and want to own their tools:

- **Creators** who are tired of a subscription that can be revoked, a project
  format nobody else can open, and a "cloud" that is somebody else's computer.
- **Educators and students** who need a real editor that can be installed in a
  lab, read in a lecture, and modified for an assignment.
- **Developers** who want a well-structured, heavily tested reference for how a
  modern media pipeline is actually built in a browser.
- **Anyone** who has lost work to a crash and wondered why an editor could not
  simply have written it down.

## What it is not

Being clear about scope is how a small project ships something good rather than
half of something enormous. Explicitly **out of scope** for the foreseeable
future:

| Not in scope                     | Why                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| Colour scopes and grading wheels | A grading suite is its own product. VideOS gives you an effects chain. |
| Masks and motion tracking        | Compositing depth belongs in a compositor.                             |
| Nested sequences, multicam       | Enormous surface area, narrow audience, deep model consequences.       |
| EDL / OTIO interchange           | Worth doing eventually; not what stops anyone editing today.           |

These are refusals, not omissions. If one of them matters to you, the
[Roadmap](roadmap.md) explains how to make the case for changing it.

---

## Our values

VideOS exists because the professional tier of video editing is closed, rented,
and opaque, and it does not have to be. The point is not to build a cheaper
imitation — it is to build an **open ecosystem that stands comparison with the
professional offerings** on the things that actually matter: accuracy, speed,
and trust.

Six commitments follow from that.

### 1. An open ecosystem, not an open-source product

The goal is a whole ecosystem — effects, transitions, panels, importers,
integrations — that anyone can extend and nobody can revoke. That means:

- **A readable project format.** A `.videos` file is a zip containing plain
  JSON. You can open it in a text editor, diff it in git, and write a script
  against it without asking permission. A bare `project.json` is also valid
  input, so the bundle is a strict superset.
- **Media referenced by content, not by path.** Every asset is keyed by a hash
  of its bytes, so a project opens on another machine and relinks by _identity_
  rather than by hoping the folder structure survived.
- **Extension points inside the app, not around it.** Panels, commands, effects
  and transitions are all registries. Today they are compiled in; the
  [Developer Guide](developer/README.md) documents each one and states honestly
  what is not yet a plugin loader.

### 2. Comparable to the professional offerings, measured on the hard parts

An editor is judged on whether the picture is the frame you asked for and
whether the file matches what you saw. So:

- **Every time in the document is an integer frame**, and the frame rate is
  rational, so 29.97 and 23.976 are exact rather than approximately right.
- **One clock, derived from the audio hardware**, so picture and sound cannot
  drift apart. There is no per-frame sync correction anywhere in the codebase,
  because there is nothing to correct.
- **Export is deterministic.** One frame is written per timeline frame,
  timestamped from its frame index rather than from how long the render took.
  Preview and export run _literally the same_ scene builder and compositor, so
  the exported file cannot diverge from what you watched.

### 3. Honesty in the interface

A control that looks functional and does nothing is worse than no control at
all. VideOS holds a hard line here:

- Unimplemented things are **disabled or labelled**, never silently inert.
- A retimed clip's audio is pitched, and the Properties panel _says so_, rather
  than offering a pitch-preservation checkbox that would be a lie. (There is no
  time-stretcher yet — see [Roadmap](roadmap.md).)
- A container that cannot be encoded on your machine is shown greyed out with
  the reason, rather than silently substituting another format and giving you a
  WebM file named `.mp4`.
- Media that cannot be read produces a banner offering a one-click reconnect,
  never a silent deletion and never a black clip you discover on export day.

### 4. Your work is not lost

- **Undo is a document snapshot**, not a hand-written inverse per operation. A
  snapshot cannot be subtly wrong, and structural sharing keeps a step at a few
  kilobytes even on a large project.
- **Autosave writes to OPFS**, which has no quota cliff, and keeps the last ten
  revisions. A normal reload restores silently. After a crash you are offered
  the chance to go _further back_ than the newest autosave — because when the
  editor crashed, the state it saved may be the state that crashed it.
- **Nothing is ever deleted implicitly.** A lapsed file permission is a prompt,
  not a discarded handle.

### 5. Written down, including the parts that went wrong

[`docs/findings.md`](../docs/findings.md) is a running engineering log of every
defect found and every trade-off taken, including the ones that leave something
worse than ideal in the tree, and including plans that were _refused_ after
turning out to be wrong. A phase is not complete until its gaps are recorded.

This matters to users too: it is how you can tell the difference between a
feature that is deferred and one that was quietly skipped.

### 6. Tests that drive the real thing

Every UI bug this project has found was invisible to unit tests and obvious the
moment a test mounted the real panel and dispatched a real pointer event. So
the suite renders in real WebGL2 and probes named pixels, exports a synthetic
timeline and demuxes the result to assert exact presentation timestamps, and
counts decoded frames created-minus-closed so a leak has somewhere to fail.

Test media is generated rather than committed — a fixture encodes a clip with a
burned-in binary frame counter and a test tone, so "the filmstrip shows
successive frames" is a strictly increasing sequence of decoded numbers rather
than somebody's opinion of a picture.

---

## Where the project is right now

Delivered and working: the docking panel system, multi-track timeline editing
with ripple/roll/slip/slide, frame-accurate playback and J/K/L shuttle,
deterministic export with real codec negotiation, eight keyframable effects and
four transitions, titles, per-clip audio with fades and a metered mixer,
markers with chapter export, subtitles with SRT/VTT import and burn-in,
three-point editing with a source monitor, portable project bundles, and
autosave with crash recovery.

Roughly 580 automated tests run in CI on every push.

Next up is the desktop shell, then a hardening pass. The details, including
what is deliberately not being built, are in the [Roadmap](roadmap.md).

---

**Next:** [Getting Started →](getting-started.md)
