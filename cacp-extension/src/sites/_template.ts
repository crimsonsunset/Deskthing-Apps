import { SiteHandler } from './base-handler.js';

export class YourSiteHandler extends SiteHandler {
  static config = {
    name: 'Your Site Name',
    urlPatterns: [
      'yoursite.com',
      'music.yoursite.com',
    ],
    selectors: {
      playButton: '.play-button',
      pauseButton: '.pause-button',
      nextButton: '.next-button',
      prevButton: '.prev-button',
      title: '.track-title',
      artist: '.artist-name',
      album: '.album-name',
      artwork: '.album-art img',
      currentTime: '.current-time',
      duration: '.total-time',
      progressBar: '.progress-bar',
    },
  };
}

export default YourSiteHandler;
