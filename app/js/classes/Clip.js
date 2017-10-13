class Clip {
    constructor(parentNode, src, start) {
        this.parentNode = parentNode;
        this.src = src;
        this.timing = [start, 0, 0];
        this.linkedClip = null;
    }

    get start() {
        return this.timing[0];
    }

    set start(value) {
        if (this.linkedClip) {
            this.linkedClip.timing[0] -= this.timing[0] - value;
            this.linkedClip.reschedule('start');
        }
        this.timing[0] = value;
        this.reschedule('start');
    }

    get offset() {
        return this.timing[1];
    }

    set offset(value) {
        if (this.linkedClip) {
            this.linkedClip.timing[1] -= this.timing[1] - value;
            this.linkedClip.reschedule('offset');
        }
        this.timing[1] = value;
        this.reschedule('offset');
    }

    get duration() {
        return this.timing[2];
    }

    set duration(value) {
        if (this.linkedClip) {
            this.linkedClip.timing[2] -= this.timing[2] - value;
            this.linkedClip.reschedule('duration');
        }
        this.timing[2] = value;
        this.reschedule('duration');
    }

    get end() {
        return this.start + this.duration;
    }

    set end(value) {
        this.duration = value - this.start;
    }

    link(linkedClip) {
        this.linkedClip = linkedClip;
        linkedClip.linkedClip = this;
    }

    unlink() {
        if (this.linkedClip) {
            this.linkedClip = this.linkedClip.linkedClip = null;
        }
    }

    split(atTime) {
        if (atTime < this.start || atTime > this.end) {
            return false;
        }

        const newClip = this.parentNode.addClipAtTime(this.src, atTime, true);

        if (this.linkedClip) {
            const newLinkedClip = this.linkedClip.parentNode.addClipAtTime(this.linkedClip.src, atTime, true);
            newClip.linkedClip = newLinkedClip;
            newLinkedClip.linkedClip = newClip;
        }

        newClip.offset += atTime - this.start;
        this.end = atTime;

        return newClip;
    }

    reschedule() {}
}

module.exports = Clip;
