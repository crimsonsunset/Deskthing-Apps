/**
 * Single source of truth for the audio/MSE media elements SoundCloud's page
 * swaps in and out. Both SeekController and MediaDetectionController read
 * and write through this instance instead of holding their own copies.
 */
export class MediaElementRegistry {
  audioEl: HTMLMediaElement | null;
  mseElement: HTMLMediaElement | null;

  constructor() {
    this.audioEl = null;
    this.mseElement = null;
  }
}
