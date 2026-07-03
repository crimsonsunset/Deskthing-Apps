/**
 * CACP Settings Page - Site Priority Management
 * Provides drag-drop interface for configuring site priorities and auto-switch behavior
 */

import jsgLogger, { type LoggerInstanceType } from '@crimsonsunset/jsg-logger';

const logger = jsgLogger as unknown as LoggerInstanceType;
const log = logger.settings;

interface SiteDisplayConfig {
  icon: string;
  className: string;
  description: string;
}

interface PriorityManager {
  sitePriorities: Map<string, number>;
  autoSwitchEnabled: boolean;
  getAllPriorities: () => Record<string, number>;
  setPriorities: (priorities: Record<string, number>) => void;
}

interface SitePrioritiesStorage {
  sitePriorities?: Record<string, number>;
  autoSwitchEnabled?: boolean;
  version?: number;
}

let priorityManager: PriorityManager | null = null;
let currentSites: string[] = [];
let isLoading = false;
let draggedElement: HTMLElement | null = null;

const SITE_CONFIG: Record<string, SiteDisplayConfig> = {
  SoundCloud: {
    icon: '☁️',
    className: 'soundcloud',
    description: 'Audio streaming and sharing platform',
  },
  YouTube: {
    icon: '📺',
    className: 'youtube',
    description: 'Video platform with music content',
  },
  'YouTube Music': {
    icon: '🎵',
    className: 'youtube',
    description: 'Dedicated music streaming service',
  },
  Spotify: {
    icon: '🎧',
    className: 'spotify',
    description: 'Music streaming platform',
  },
  'Apple Music': {
    icon: '🍎',
    className: 'apple',
    description: "Apple's music streaming service",
  },
};

/**
 * Returns a required DOM element by id.
 * @param id - Element id
 */
function getRequiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element;
}

/**
 * Initialize settings page
 */
async function initializeSettings(): Promise<void> {
  try {
    const extVersion = chrome?.runtime?.getManifest?.().version || 'unknown';
    log.info(`CACP Settings v${extVersion} - Initializing...`);
  } catch {
    log.info('CACP Settings - Initializing...');
  }

  try {
    await loadSettings();
    setupEventListeners();

    getRequiredElement('loading').style.display = 'none';
    getRequiredElement('settings-content').style.display = 'block';

    log.info('Initialization complete');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Initialization failed:', { error: err.message, stack: err.stack });
    showMessage(`Failed to load settings: ${err.message}`, 'error');
  }
}

/**
 * Load current settings from storage
 */
async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get('cacp-site-priorities');
    const data = (result['cacp-site-priorities'] as SitePrioritiesStorage | undefined) || {};

    priorityManager = {
      sitePriorities: new Map(Object.entries(data.sitePriorities || {})),
      autoSwitchEnabled: data.autoSwitchEnabled !== false,
      getAllPriorities() {
        return Object.fromEntries(this.sitePriorities);
      },
      setPriorities(priorities: Record<string, number>) {
        this.sitePriorities = new Map(Object.entries(priorities));
      },
    };

    currentSites = Object.keys(SITE_CONFIG);

    updatePriorityList();
    updateAutoSwitchToggle();
    updateStatusDisplay();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Failed to load settings:', { error: err.message, stack: err.stack });
    throw error;
  }
}

/**
 * Save settings to storage
 */
async function saveSettings(): Promise<void> {
  if (isLoading || !priorityManager) return;

  try {
    isLoading = true;
    getRequiredElement('save-btn').textContent = 'Saving...';

    const data: SitePrioritiesStorage = {
      sitePriorities: priorityManager.getAllPriorities(),
      autoSwitchEnabled: priorityManager.autoSwitchEnabled,
      version: 1,
    };

    await chrome.storage.sync.set({ 'cacp-site-priorities': data });

    showMessage('Settings saved successfully!', 'success');
    log.info('Settings saved:', data);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Failed to save settings:', { error: err.message, stack: err.stack });
    showMessage(`Failed to save settings: ${err.message}`, 'error');
  } finally {
    isLoading = false;
    getRequiredElement('save-btn').textContent = 'Save Settings';
  }
}

/**
 * Reset settings to defaults
 */
async function resetSettings(): Promise<void> {
  if (!confirm('Are you sure you want to reset all settings to defaults?')) {
    return;
  }

  if (!priorityManager) return;

  try {
    await chrome.storage.sync.remove('cacp-site-priorities');

    priorityManager.sitePriorities.clear();
    priorityManager.autoSwitchEnabled = true;

    updatePriorityList();
    updateAutoSwitchToggle();

    showMessage('Settings reset to defaults', 'success');
    log.info('Settings reset to defaults');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('Failed to reset settings:', { error: err.message, stack: err.stack });
    showMessage(`Failed to reset settings: ${err.message}`, 'error');
  }
}

/**
 * Update priority list display
 */
function updatePriorityList(): void {
  if (!priorityManager) return;

  const listEl = getRequiredElement('priority-list');

  const sortedSites = currentSites
    .map((name) => ({
      name,
      priority: priorityManager!.sitePriorities.get(name) || (currentSites.indexOf(name) + 1) * 10,
    }))
    .sort((a, b) => a.priority - b.priority);

  const html = sortedSites
    .map((site, index) => {
      const config = SITE_CONFIG[site.name] || {
        icon: '🌐',
        className: 'generic',
        description: 'Unknown site',
      };

      return `
      <li class="priority-item" draggable="true" data-site="${site.name}">
        <div class="priority-rank">${index + 1}</div>
        <div class="site-info">
          <div class="site-icon ${config.className}">${config.icon}</div>
          <div class="site-details">
            <h3>${site.name}</h3>
            <p>${config.description}</p>
          </div>
        </div>
        <div class="drag-handle">⋮⋮</div>
      </li>
    `;
    })
    .join('');

  listEl.innerHTML = html;
  setupDragAndDrop();
}

/**
 * Update auto-switch toggle
 */
function updateAutoSwitchToggle(): void {
  if (!priorityManager) return;

  const toggle = getRequiredElement('auto-switch-toggle');
  toggle.className = `toggle-switch ${priorityManager.autoSwitchEnabled ? 'active' : ''}`;
}

/**
 * Update status display
 */
function updateStatusDisplay(): void {
  getRequiredElement('registered-count').textContent = String(currentSites.length);
  getRequiredElement('active-count').textContent = '0';
  getRequiredElement('connection-status').textContent = 'Unknown';
}

/**
 * Set up drag and drop functionality
 */
function setupDragAndDrop(): void {
  const items = document.querySelectorAll('.priority-item');

  items.forEach((item) => {
    const element = item as HTMLElement;
    element.addEventListener('dragstart', (e) => handleDragStart(element, e as DragEvent));
    element.addEventListener('dragover', (e) => handleDragOver(element, e as DragEvent));
    element.addEventListener('drop', (e) => handleDrop(element, e as DragEvent));
    element.addEventListener('dragend', handleDragEnd);
  });
}

/**
 * Handle drag start on a priority item
 * @param element - Dragged list item
 * @param e - Drag event
 */
function handleDragStart(element: HTMLElement, e: DragEvent): void {
  draggedElement = element;
  element.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', element.outerHTML);
  }
}

/**
 * Handle drag over a priority item
 * @param element - Target list item
 * @param e - Drag event
 */
function handleDragOver(element: HTMLElement, e: DragEvent): void {
  e.preventDefault();
  element.classList.add('drag-over');
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
}

/**
 * Handle drop on a priority item
 * @param element - Target list item
 * @param e - Drag event
 */
function handleDrop(element: HTMLElement, e: DragEvent): void {
  e.stopPropagation();

  if (draggedElement && draggedElement !== element) {
    const list = getRequiredElement('priority-list');
    const items = Array.from(list.children);

    const draggedIndex = items.indexOf(draggedElement);
    const targetIndex = items.indexOf(element);

    if (draggedIndex < targetIndex) {
      element.parentNode?.insertBefore(draggedElement, element.nextSibling);
    } else {
      element.parentNode?.insertBefore(draggedElement, element);
    }

    updatePrioritiesFromOrder();
  }
}

/**
 * Handle drag end cleanup
 */
function handleDragEnd(): void {
  const items = document.querySelectorAll('.priority-item');
  items.forEach((item) => {
    item.classList.remove('dragging', 'drag-over');
  });
  draggedElement = null;
}

/**
 * Update priorities based on current order
 */
function updatePrioritiesFromOrder(): void {
  if (!priorityManager) return;

  const items = document.querySelectorAll('.priority-item');
  const newPriorities: Record<string, number> = {};

  items.forEach((item, index) => {
    const siteName = (item as HTMLElement).dataset.site;
    if (!siteName) return;

    newPriorities[siteName] = (index + 1) * 10;

    const rankEl = item.querySelector('.priority-rank');
    if (rankEl) {
      rankEl.textContent = String(index + 1);
    }
  });

  priorityManager.setPriorities(newPriorities);
  log.debug('Updated priorities:', newPriorities);
}

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  getRequiredElement('save-btn').addEventListener('click', () => void saveSettings());
  getRequiredElement('reset-btn').addEventListener('click', () => void resetSettings());
  getRequiredElement('test-btn').addEventListener('click', () => void testConnection());
  getRequiredElement('auto-switch-toggle').addEventListener('click', toggleAutoSwitch);
}

/**
 * Toggle auto-switch setting
 */
function toggleAutoSwitch(): void {
  if (!priorityManager) return;

  priorityManager.autoSwitchEnabled = !priorityManager.autoSwitchEnabled;
  updateAutoSwitchToggle();
  console.log('[CACP Settings] Auto-switch toggled:', priorityManager.autoSwitchEnabled);
}

/**
 * Test DeskThing connection
 */
async function testConnection(): Promise<void> {
  const btn = getRequiredElement('test-btn') as HTMLButtonElement;
  btn.textContent = 'Testing...';
  btn.disabled = true;

  try {
    const ws = new WebSocket('ws://localhost:8081');

    ws.onopen = () => {
      showMessage('Connection to DeskThing successful!', 'success');
      ws.close();
    };

    ws.onerror = () => {
      showMessage('Failed to connect to DeskThing. Make sure the app is running.', 'error');
    };

    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        showMessage('Connection timeout. Make sure DeskThing is running on localhost:8081.', 'error');
      }
    }, 5000);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    showMessage(`Connection test failed: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      btn.textContent = 'Test Connection';
      btn.disabled = false;
    }, 2000);
  }
}

/**
 * Show message to user
 * @param text - Message text
 * @param type - Message style variant
 */
function showMessage(text: string, type: 'success' | 'error' = 'success'): void {
  const messageEl = getRequiredElement('message');
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.style.display = 'block';

  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  void initializeSettings();
});
