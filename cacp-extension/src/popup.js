/**
 * CACP Extension Popup Interface
 * Testing and monitoring interface for Chrome extension
 */

import logger from '@crimsonsunset/jsg-logger';
import {
  escapeHtml,
  findCurrentTracklistTrack,
  formatCueSeconds,
  getTrackDurationSeconds,
} from './tracklist-popup.helpers.js';

// Get version dynamically from manifest
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
let logs = [];

// Initialize popup logger
const popupLogger = logger.getComponent('popup');

// Utility to format seconds to mm:ss
function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

class CACPPopup {
  constructor() {
    this.globalState = null;
    this.updateInterval = null;
    this.isRefreshing = false;
    
    popupLogger.info('CACP Popup initialized');
  }

  /**
   * Initialize popup interface
   */
  async initialize() {
    popupLogger.debug('Initializing popup interface');
    
    // Set up UI event listeners
    this.setupEventListeners();
    
    // Set version in UI
    this.updateVersionDisplay();
    
    // Ensure debug logs panel starts expanded by default
    try {
      const debugInfo = document.getElementById('debugInfo');
      if (debugInfo) {
        debugInfo.classList.remove('hidden');
      }
    } catch {}

    // Start periodic updates
    this.startPeriodicUpdates();
    
    // Load initial state
    await this.refreshGlobalState();
    
    popupLogger.info('Popup interface ready');

    // Prime the log view so users see something immediately
    this.log('Popup opened (v' + EXTENSION_VERSION + ')');
  }

  /**
   * Set up event listeners for UI elements
   */
  setupEventListeners() {
    // Global control buttons
    const globalPlayBtn = document.getElementById('globalPlay');
    const globalPauseBtn = document.getElementById('globalPause');
    const globalNextBtn = document.getElementById('globalNext');
    const globalPrevBtn = document.getElementById('globalPrev');

    if (globalPlayBtn) globalPlayBtn.addEventListener('click', () => this.sendGlobalCommand('play'));
    if (globalPauseBtn) globalPauseBtn.addEventListener('click', () => this.sendGlobalCommand('pause'));
    if (globalNextBtn) globalNextBtn.addEventListener('click', () => this.sendGlobalCommand('next'));
    if (globalPrevBtn) globalPrevBtn.addEventListener('click', () => this.sendGlobalCommand('previous'));

    const globalFavoriteBtn = document.getElementById('globalFavorite');
    if (globalFavoriteBtn) {
      globalFavoriteBtn.addEventListener('click', () => this.sendGlobalLike());
    }

    const tracklistLookupBtn = document.getElementById('tracklistLookupBtn');
    if (tracklistLookupBtn) {
      tracklistLookupBtn.addEventListener('click', () => this.sendGlobalLookup());
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshGlobalState());

    // Copy logs button
    const copyLogsBtn = document.getElementById('copyLogsBtn');
    if (copyLogsBtn) copyLogsBtn.addEventListener('click', () => this.copyLogs());

    // Debug toggle functionality
    const debugToggle = document.getElementById('debugToggle');
    const debugInfo = document.getElementById('debugInfo');
    if (debugToggle && debugInfo) {
      debugToggle.addEventListener('click', () => {
        debugInfo.classList.toggle('hidden');
      });
    }

    popupLogger.debug('Event listeners set up');
  }

  /**
   * Update version display
   */
  updateVersionDisplay() {
    const versionEl = document.getElementById('version');
    if (versionEl) {
      versionEl.textContent = `v${EXTENSION_VERSION}`;
    }
  }

  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    // Poll frequently; background will dedupe
    this.updateInterval = setInterval(() => {
      this.refreshGlobalState();
    }, 1000);
    // Subscribe to background push events even if popup reopens later
    chrome.runtime.sendMessage({ type: 'get-global-state' }).then(() => {}).catch(() => {});

    // Lifecycle diagnostics to catch the popup "dying" issue
    try {
      const start = Date.now();
      this.log('Popup heartbeat started');
      this.heartbeat = setInterval(() => {
        const aliveMs = Date.now() - start;
        if (aliveMs % 5000 < 1000) {
          // Log every ~5s without spamming
          popupLogger.trace('Popup heartbeat', { aliveMs });
        }
      }, 1000);

      // Log visibility changes; Chrome may suspend timers when hidden
      document.addEventListener('visibilitychange', () => {
        popupLogger.debug('Popup visibilitychange', { hidden: document.hidden });
      });

      // Log runtime disconnects which could kill messaging
      chrome.runtime.onDisconnect.addListener((port) => {
        popupLogger.warn('Popup runtime disconnect detected');
      });
    } catch {}
  }

  /**
   * Get global media state from background script
   */
  async refreshGlobalState() {
    if (this.isRefreshing) return;
    this.isRefreshing = true;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-global-state' });
      
      if (response) {
        this.globalState = response;
        this.updateUI();
        
        popupLogger.trace('Global state updated', {
          sourceCount: response.sources?.length || 0,
          currentPriority: response.currentPriority?.site
        });
      }
    } catch (error) {
      this.log('Failed to get global state: ' + error.message, 'error');
      popupLogger.error('Failed to refresh global state', { error: error.message });
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Update the entire UI based on current global state
   */
  updateUI() {
    if (!this.globalState) {
      this.showNoSources();
      return;
    }

    const { sources, currentPriority, totalSources } = this.globalState;
    
    // Update status
    this.updateStatus(totalSources, currentPriority);
    
    // Update sources list
    this.updateSourcesList(sources);
    
    // Update global controls
    this.updateGlobalControls(currentPriority);

    // Update tracklist panel
    this.updateTracklistPanel(currentPriority);

    const tracklistState = this.globalState.tracklistState ?? { status: 'idle', error: null, result: null };

    if (this.globalState.favoriteStatus === 'ready') {
      this.log('Track liked on SoundCloud');
      chrome.runtime.sendMessage({ type: 'reset-favorite-status' }).catch(() => {});
    } else if (this.globalState.favoriteStatus === 'error' && this.globalState.favoriteError) {
      this.log('Like failed: ' + this.globalState.favoriteError, 'error');
      chrome.runtime.sendMessage({ type: 'reset-favorite-status' }).catch(() => {});
    }

    if (tracklistState.status === 'ready' && tracklistState.result) {
      this.log('Tracklist loaded: ' + tracklistState.result.mixTitle + ' (' + tracklistState.result.tracks.length + ' tracks)');
      chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    } else if (tracklistState.status === 'ready' && !tracklistState.result) {
      this.log('No 1001tracklists match for this mix');
      chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    } else if (tracklistState.status === 'error' && tracklistState.error) {
      this.log('Tracklist lookup failed: ' + tracklistState.error, 'error');
      chrome.runtime.sendMessage({ type: 'reset-tracklist-lookup-status' }).catch(() => {});
    }
  }

  /**
   * Show no sources message
   */
  showNoSources() {
    const statusEl = document.getElementById('status');
    const sourcesListEl = document.getElementById('sourcesList');
    
    if (statusEl) {
      statusEl.innerHTML = '<div class="status-item"><span class="status-label">Status:</span><span class="status-value">No active media sources</span></div>';
    }
    
    if (sourcesListEl) {
      sourcesListEl.innerHTML = '<div class="no-sources"><p>🎵 No media detected</p><p>Open a supported music site in any tab to get started!</p><div class="supported-sites"><small>Supported: SoundCloud, YouTube</small></div></div>';
    }

    // Disable global controls
    this.setGlobalControlsEnabled(false);
  }

  /**
   * Whether the popup can like the current SoundCloud source.
   * @param {object|null} source - Active media source from background.
   * @returns {boolean}
   */
  canLikeSource(source) {
    if (!source?.isActive || !source.canControl) return false;
    return source.site === 'SoundCloud';
  }

  /**
   * Whether the popup can request a 1001tracklists lookup for the current source.
   * @param {object|null} source - Active media source from background.
   * @returns {boolean}
   */
  canLookupSource(source) {
    if (!source?.isActive) return false;
    const title = source.trackInfo?.title?.trim();
    return Boolean(title && title !== 'Unknown Track');
  }

  /**
   * Resolves now-playing display fields, preferring server-enriched Format A metadata.
   * @param {object|null} currentPriority - Active priority source from background.
   * @param {object|null|undefined} enrichedDisplay - Server-provided in-mix overlay.
   * @returns {{ title: string, artist: string, artwork: string }} Display fields for UI.
   */
  resolveNowPlayingDisplay(currentPriority, enrichedDisplay) {
    const fallbackTitle = currentPriority?.trackInfo?.title || 'No track';
    const fallbackArtist = currentPriority?.trackInfo?.artist || '';
    const fallbackArtwork =
      currentPriority?.trackInfo?.artwork?.[0]?.src ||
      currentPriority?.trackInfo?.artwork?.[0] ||
      '';

    if (!enrichedDisplay?.title) {
      return {
        title: fallbackTitle,
        artist: fallbackArtist,
        artwork: fallbackArtwork,
      };
    }

    return {
      title: enrichedDisplay.title,
      artist: enrichedDisplay.artist || fallbackArtist,
      artwork: enrichedDisplay.thumbnail || fallbackArtwork,
    };
  }

  /**
   * Update status section
   */
  updateStatus(totalSources, currentPriority) {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;

    const enrichedDisplay = this.globalState?.enrichedDisplay;
    const display = this.resolveNowPlayingDisplay(currentPriority, enrichedDisplay);
    const prioritySite = currentPriority ? currentPriority.site : 'None';
    const priorityTrack = display.title;
    const priorityArtist = display.artist;
    const artwork = display.artwork;
    const isPlaying = !!currentPriority?.isPlaying;
    const currentTime = currentPriority?.currentTime ?? 0;
    const duration = currentPriority?.duration ?? 0;
    const pct = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

    statusEl.innerHTML = '' +
      '<div class="status-item"><span class="status-label">Active Sources:</span><span class="status-value">' + totalSources + '</span></div>' +
      '<div class="status-item"><span class="status-label">Priority:</span><span class="status-value">' + prioritySite + '</span></div>' +
      '<div class="status-item" style="align-items:flex-start; gap:8px">' +
      '  <span class="status-label" style="margin-top:2px">Now Playing:</span>' +
      '  <span class="status-value" style="display:flex; align-items:center; gap:10px;">' +
      (artwork ? '<img src="' + artwork + '" alt="art" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid #333;" />' : '') +
      '    <div style="display:flex; flex-direction:column; gap:6px; min-width:220px;">' +
      '      <div>' + priorityTrack + '</div>' +
      (priorityArtist ? '      <div style="font-size:11px; color:#888">' + priorityArtist + '</div>' : '') +
      '      <div id="globalProgress" class="progress-click" style="height:6px; background:#333; border-radius:4px; overflow:hidden; position:relative; cursor:pointer;">' +
      '        <div style="position:absolute; left:0; top:0; bottom:0; width:' + pct + '%; background:' + (isPlaying ? '#00B894' : '#555') + ';"></div>' +
      '      </div>' +
      '      <div style="font-size:10px; color:#888">' + (formatTime(currentTime)) + ' / ' + (formatTime(duration)) + (isPlaying ? ' • Playing' : ' • Paused') + '</div>' +
      '    </div>' +
      '  </span>' +
      '</div>';

    // Attach click-to-seek on the global progress bar
    try {
      const bar = document.getElementById('globalProgress');
      if (bar && duration > 0) {
        bar.onclick = (ev) => {
          const rect = bar.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          const target = Math.floor(duration * ratio);
          console.log('[CACP-Seek] popup global progress click', { ratio, targetSeconds: target, duration });
          this.sendGlobalSeek(target);
        };
      }
    } catch {}
  }

  /**
   * Update sources list
   */
  updateSourcesList(sources) {
    const sourcesListEl = document.getElementById('sourcesList');
    if (!sourcesListEl) return;

    if (sources.length === 0) {
      this.showNoSources();
      return;
    }

    sourcesListEl.innerHTML = sources.map(source => this.createSourceItem(source)).join('');

    // Add event listeners to source controls
    sources.forEach(source => {
      this.attachSourceEventListeners(source.tabId);
    });
  }

  /**
   * Create HTML for a single source item
   */
  createSourceItem(source) {
    const isPriority = source.isPriority;
    const enrichedDisplay = isPriority ? this.globalState?.enrichedDisplay : null;
    const display = this.resolveNowPlayingDisplay(
      isPriority ? this.globalState?.currentPriority : source,
      enrichedDisplay,
    );
    const trackTitle = display.title || 'Unknown Track';
    const trackArtist = display.artist || 'Unknown Artist';
    const artwork = display.artwork;
    const isPlaying = source.isPlaying;
    const canControl = source.canControl;
    const isActive = source.isActive;
    const isInMix = isPriority && !!this.globalState?.enrichedDisplay?.title;
    const showLike = this.canLikeSource(source);
    const pct = source.duration > 0 ? Math.round((source.currentTime / source.duration) * 100) : 0;
    
    const priorityBadge = isPriority ? '<span class="priority-badge">★ Priority</span>' : '';
    const statusIcon = isActive ? (isPlaying ? '▶️' : '⏸️') : '⏹️';
    const statusText = isActive ? (isPlaying ? 'Playing' : 'Paused') : 'Inactive';
    
    return '' +
      '<div class="source-item ' + (isPriority ? 'priority' : '') + ' ' + (isActive ? 'active' : 'inactive') + '" data-tab-id="' + source.tabId + '">' +
      '  <div class="source-header">' +
      '    <div class="source-info">' +
      '      <div class="source-site">' + source.site + ' ' + priorityBadge + '</div>' +
      '      <div class="source-status">' + statusIcon + ' ' + statusText + '</div>' +
      '    </div>' +
      '    <div class="source-controls">' + (canControl && isActive ? (
      '      <button class="control-btn prev-btn" data-command="previous" data-tab-id="' + source.tabId + '" title="Previous">⏮️</button>' +
      '      <button class="control-btn ' + (isPlaying ? 'pause-btn' : 'play-btn') + '" data-command="' + (isPlaying ? 'pause' : 'play') + '" data-tab-id="' + source.tabId + '" title="' + (isPlaying ? 'Pause' : 'Play') + '">' + (isPlaying ? '⏸️' : '▶️') + '</button>' +
      '      <button class="control-btn next-btn" data-command="next" data-tab-id="' + source.tabId + '" title="Next">⏭️</button>' +
      (showLike ? '      <button class="control-btn favorite-btn" data-action="like" data-tab-id="' + source.tabId + '" data-in-mix="' + (isPriority && isInMix ? '1' : '0') + '" title="Like on SoundCloud">♥</button>' : '')
      ) : '<span class="no-controls">' + (!canControl ? 'No controls' : 'Not ready') + '</span>') +
      '    </div>' +
      '  </div>' +
      '  <div class="source-track" style="display:flex; gap:10px; align-items:center;">' +
      (artwork ? '<img src="' + artwork + '" alt="art" style="width:34px; height:34px; object-fit:cover; border-radius:4px; border:1px solid #333;" />' : '') +
      '    <div style="flex:1; min-width:120px;">' +
      '      <div class="track-title">' + trackTitle + '</div>' +
      '      <div class="track-artist">' + trackArtist + '</div>' +
      '      <div class="progress-click" data-tab-id="' + source.tabId + '" data-duration="' + (source.duration || 0) + '" style="height:6px; background:#333; border-radius:4px; overflow:hidden; position:relative; margin-top:6px; cursor:pointer;">' +
      '        <div style="position:absolute; left:0; top:0; bottom:0; width:' + pct + '%; background:' + (isPlaying ? '#00B894' : '#555') + ';"></div>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      (!isPriority && isActive ? '<button class="set-priority-btn" data-tab-id="' + source.tabId + '">Set as Priority</button>' : '') +
      '</div>';
  }

  /**
   * Attach event listeners to source controls
   */
  attachSourceEventListeners(tabId) {
    // Control buttons
    const controlBtns = document.querySelectorAll('[data-tab-id="' + tabId + '"][data-command]');
    controlBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const command = e.target.dataset.command;
        const targetTabId = parseInt(e.target.dataset.tabId);
        this.sendSourceCommand(command, targetTabId);
      });
    });

    const likeBtn = document.querySelector('[data-tab-id="' + tabId + '"][data-action="like"]');
    if (likeBtn) {
      likeBtn.addEventListener('click', () => {
        const targetTabId = parseInt(likeBtn.dataset.tabId, 10);
        const isInMix = likeBtn.dataset.inMix === '1';
        if (isInMix) {
          void this.sendGlobalLike();
          return;
        }
        void this.sendSourceLike(targetTabId);
      });
    }

    // Set priority button
    const priorityBtn = document.querySelector('.set-priority-btn[data-tab-id="' + tabId + '"]');
    if (priorityBtn) {
      priorityBtn.addEventListener('click', (e) => {
        const targetTabId = parseInt(e.target.dataset.tabId);
        this.setPriority(targetTabId);
      });
    }

    // Click-to-seek on per-source progress bar
    const progress = document.querySelector('.source-item[data-tab-id="' + tabId + '"] .progress-click');
    if (progress) {
      progress.onclick = (ev) => {
        const duration = parseInt(progress.getAttribute('data-duration') || '0', 10);
        if (!duration || duration <= 0) return;
        const rect = progress.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const target = Math.floor(duration * ratio);
        console.log('[CACP-Seek] popup source progress click', { tabId, ratio, targetSeconds: target, duration });
        this.sendSourceSeek(tabId, target);
      };
    }
  }

  /**
   * Update global controls based on priority source
   */
  updateGlobalControls(currentPriority) {
    const hasActivePriority = currentPriority && currentPriority.isActive;
    this.setGlobalControlsEnabled(hasActivePriority);

    const globalFavoriteBtn = document.getElementById('globalFavorite');
    const canLike = this.canLikeSource(currentPriority);
    const isFavoriteLoading = this.globalState?.favoriteStatus === 'loading';
    if (globalFavoriteBtn) {
      globalFavoriteBtn.disabled = !canLike || isFavoriteLoading;
      globalFavoriteBtn.title = isFavoriteLoading ? 'Liking…' : 'Like on SoundCloud';
    }

    const tracklistLookupBtn = document.getElementById('tracklistLookupBtn');
    const canLookup = this.canLookupSource(currentPriority);
    const tracklistStatus = this.globalState?.tracklistState?.status ?? 'idle';
    const isLookupLoading = tracklistStatus === 'loading';
    if (tracklistLookupBtn) {
      tracklistLookupBtn.disabled = !canLookup || isLookupLoading;
      tracklistLookupBtn.textContent = isLookupLoading ? 'Looking up…' : 'Lookup current mix';
    }

    if (hasActivePriority) {
      // Update play/pause button state
      const globalPlayBtn = document.getElementById('globalPlay');
      const globalPauseBtn = document.getElementById('globalPause');
      
      if (globalPlayBtn && globalPauseBtn) {
        if (currentPriority.isPlaying) {
          globalPlayBtn.style.display = 'none';
          globalPauseBtn.style.display = 'inline-block';
        } else {
          globalPlayBtn.style.display = 'inline-block';
          globalPauseBtn.style.display = 'none';
        }
      }
    }
  }

  /**
   * Renders the 1001tracklists panel (status, mix title, scrollable track rows).
   * @param {object|null} currentPriority - Active priority source from background.
   */
  updateTracklistPanel(currentPriority) {
    const panelEl = document.getElementById('tracklistPanel');
    if (!panelEl) {
      return;
    }

    const tracklistState = this.globalState?.tracklistState ?? { status: 'idle', error: null, result: null };
    const { status, error, result } = tracklistState;
    const progressMs = (currentPriority?.currentTime ?? 0) * 1000;
    const mixDurationSeconds = currentPriority?.duration ?? null;
    const canSeek = Boolean(currentPriority?.isActive && currentPriority?.canControl);

    if (status === 'loading') {
      panelEl.innerHTML = '<p class="tracklist-status">Looking up tracklist…</p>';
      return;
    }

    if (status === 'error' && error) {
      panelEl.innerHTML = '<p class="tracklist-error">' + escapeHtml(error) + '</p>';
      return;
    }

    if (status === 'ready' && !result) {
      panelEl.innerHTML = '<p class="tracklist-status">No 1001tracklists match for this mix.</p>';
      return;
    }

    if (!result) {
      panelEl.innerHTML = '<p class="tracklist-status">Auto-lookup runs on long mixes. Or hit Lookup current mix.</p>';
      return;
    }

    const currentTrack = findCurrentTracklistTrack(result.tracks, progressMs);
    const rowsHtml = result.tracks.map((track, index) => {
      const isActive = currentTrack?.order === track.order;
      const durationSeconds = getTrackDurationSeconds(result.tracks, index, mixDurationSeconds);
      const trackLabel = (track.artist ? track.artist + ' — ' : '') + track.title;
      const canSeekRow = canSeek && track.cueSeconds != null;

      return '' +
        '<li class="' + (isActive ? 'is-active' : '') + '">' +
        '  <button type="button" class="tracklist-row-button" data-cue-seconds="' + (track.cueSeconds ?? '') + '" ' + (canSeekRow ? '' : 'disabled') + '>' +
        '    <span class="tracklist-cue">' + formatCueSeconds(track.cueSeconds) + '</span>' +
        '    <span class="tracklist-track" title="' + escapeHtml(trackLabel) + '">' + escapeHtml(trackLabel) + '</span>' +
        '    <span class="tracklist-duration">' + (durationSeconds != null ? formatCueSeconds(durationSeconds) : '') + '</span>' +
        '  </button>' +
        '</li>';
    }).join('');

    panelEl.innerHTML = '' +
      '<p class="tracklist-mix-title">' + escapeHtml(result.mixTitle) + '</p>' +
      (currentTrack
        ? '<p class="tracklist-now">Now in mix: ' + escapeHtml(currentTrack.artist + ' — ' + currentTrack.title) + '</p>'
        : '') +
      '<ol class="tracklist-rows">' + rowsHtml + '</ol>';

    panelEl.querySelectorAll('.tracklist-row-button[data-cue-seconds]').forEach((button) => {
      button.addEventListener('click', () => {
        const cueSeconds = Number(button.getAttribute('data-cue-seconds'));
        if (!Number.isFinite(cueSeconds)) {
          return;
        }

        this.sendGlobalSeek(cueSeconds);
      });
    });
  }

  /**
   * Enable/disable global control buttons
   */
  setGlobalControlsEnabled(enabled) {
    const globalControls = document.querySelectorAll('.global-controls button');
    globalControls.forEach(btn => {
      btn.disabled = !enabled;
    });
  }

  /**
   * Send like command to highest priority source (via app server when in-mix).
   */
  async sendGlobalLike() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'like-track' });

      if (response?.pending) {
        this.log('Like requested…');
        setTimeout(() => this.refreshGlobalState(), 100);
        return;
      }

      if (response?.success) {
        this.log('Like sent');
      } else {
        this.log('Like failed: ' + (response?.error || 'unknown'), 'error');
      }

      setTimeout(() => this.refreshGlobalState(), 100);
    } catch (error) {
      this.log('Failed to send like: ' + error.message, 'error');
    }
  }

  /**
   * Request a forced 1001tracklists lookup for the current priority mix via the app server.
   */
  async sendGlobalLookup() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'lookup-tracklist' });

      if (response?.pending) {
        this.log('Tracklist lookup requested…');
        setTimeout(() => this.refreshGlobalState(), 100);
        return;
      }

      if (response?.success) {
        this.log('Tracklist lookup sent');
      } else {
        this.log('Tracklist lookup failed: ' + (response?.error || 'unknown'), 'error');
      }

      setTimeout(() => this.refreshGlobalState(), 100);
    } catch (error) {
      this.log('Failed to send tracklist lookup: ' + error.message, 'error');
    }
  }

  /**
   * Send standalone like to a specific SoundCloud tab.
   * @param {number} tabId - Target tab id.
   */
  async sendSourceLike(tabId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'control-media',
        command: 'favorite',
        tabId,
      });

      if (response?.success) {
        this.log('Like sent to tab ' + tabId);
      } else {
        this.log('Like failed for tab ' + tabId + ': ' + (response?.error || 'unknown'), 'error');
      }
    } catch (error) {
      this.log('Failed to send like to tab ' + tabId + ': ' + error.message, 'error');
    }
  }

  /**
   * Send command to highest priority source
   */
  async sendGlobalCommand(command) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'control-media',
        command: command
      });

      if (response.success) {
        this.log('Global ' + command + ' command sent successfully');
        // Refresh state to see changes
        setTimeout(() => this.refreshGlobalState(), 100);
      } else {
        this.log('Global ' + command + ' command failed: ' + response.error, 'error');
      }
    } catch (error) {
      this.log('Failed to send global ' + command + ' command: ' + error.message, 'error');
    }
  }

  /**
   * Send seek command to highest priority source
   */
  async sendGlobalSeek(seconds) {
    console.log('[CACP-Seek] popup sendGlobalSeek', { seconds });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'control-media',
        command: 'seek',
        time: seconds
      });
      console.log('[CACP-Seek] popup sendGlobalSeek response', response);
      if (response?.success) {
        const d = response.detail;
        const detailSummary = d
          ? ' (method=' + d.method + ', rectWidth=' + d.rectWidth + ', clickX=' + Math.round(d.clickX || 0) + ')'
          : '';
        this.log('Seek to ' + formatTime(seconds) + ' sent successfully' + detailSummary);
        setTimeout(() => this.refreshGlobalState(), 150);
      } else {
        this.log('Seek failed: ' + (response?.error || 'unknown'), 'error');
      }
    } catch (error) {
      this.log('Failed to send seek: ' + error.message, 'error');
    }
  }

  /**
   * Send command to specific source
   */
  async sendSourceCommand(command, tabId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'control-media',
        command: command,
        tabId: tabId
      });

      if (response.success) {
        this.log(command + ' command sent to tab ' + tabId);
        // Refresh state to see changes
        setTimeout(() => this.refreshGlobalState(), 100);
      } else {
        this.log(command + ' command failed for tab ' + tabId + ': ' + response.error, 'error');
      }
    } catch (error) {
      this.log('Failed to send ' + command + ' command to tab ' + tabId + ': ' + error.message, 'error');
    }
  }

  /**
   * Send seek to a specific source
   */
  async sendSourceSeek(tabId, seconds) {
    console.log('[CACP-Seek] popup sendSourceSeek', { tabId, seconds });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'control-media',
        command: 'seek',
        tabId: tabId,
        time: seconds
      });
      if (response?.success) {
        this.log('Seek to ' + formatTime(seconds) + ' sent to tab ' + tabId);
        setTimeout(() => this.refreshGlobalState(), 150);
      } else {
        this.log('Seek failed for tab ' + tabId + ': ' + (response?.error || 'unknown'), 'error');
      }
    } catch (error) {
      this.log('Failed to send seek to tab ' + tabId + ': ' + error.message, 'error');
    }
  }

  /**
   * Set a source as priority
   */
  async setPriority(tabId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'set-priority-source',
        tabId: tabId
      });

      if (response.success) {
        this.log('Set tab ' + tabId + ' as priority source');
        this.refreshGlobalState();
      } else {
        this.log('Failed to set priority: ' + response.error, 'error');
      }
    } catch (error) {
      this.log('Failed to set priority for tab ' + tabId + ': ' + error.message, 'error');
    }
  }

  /**
   * Log message with timestamp
   */
  log(message, level = 'info', data = null) {
    const timestamp = new Date().toLocaleTimeString();
    logs.unshift('[' + timestamp + '] ' + message);
    if (logs.length > 100) logs.pop();
    
    // Also log to structured logger
    if (data) {
      popupLogger[level](message, data);
    } else {
      popupLogger[level](message);
    }
    
    this.updateLogsDisplay();
  }

  /**
   * Update logs display
   */
  updateLogsDisplay() {
    const logsEl = document.getElementById('logs');
    if (logsEl) {
      logsEl.textContent = logs.slice(0, 20).join('\n');
      logsEl.scrollTop = 0;
    }
  }

  /**
   * Copy all logs to clipboard
   */
  copyLogs() {
    const allLogs = logs.join('\n');
    navigator.clipboard.writeText(allLogs).then(() => {
      this.log('Logs copied to clipboard');
    }).catch(err => {
      this.log('Failed to copy logs: ' + err.message, 'error');
    });
  }

  /**
   * Cleanup when popup closes
   */
  cleanup() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    popupLogger.debug('Popup cleanup complete');
  }
}

// Initialize popup when DOM is ready
let popupInstance = null;

const initializePopup = async () => {
  try {
    popupInstance = new CACPPopup();
    await popupInstance.initialize();
  } catch (error) {
    popupLogger.error('Failed to initialize CACP popup', {
      error: error.message,
      stack: error.stack
    });
  }
};

// Initialize when DOM loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  initializePopup();
}

popupLogger.info('CACP popup script loaded');

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  if (popupInstance) {
    popupInstance.cleanup();
  }
});

// Listen for background script updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type.startsWith('popup-')) {
    // Handle real-time updates from background script
    if (popupInstance) {
      popupInstance.refreshGlobalState();
    }
  }
});
