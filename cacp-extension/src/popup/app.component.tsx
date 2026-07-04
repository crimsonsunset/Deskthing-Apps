import { DebugLogPanel } from '@components/debug-log-panel.component.js';
import { GlobalControls } from '@components/global-controls.component.js';
import { PopupHeader } from '@components/popup-header.component.js';
import { SourcesList } from '@components/sources-list.component.js';
import { SystemStatus } from '@components/system-status.component.js';
import { TracklistShell } from '@components/tracklist-shell.component.js';
import { usePopupCommands } from '@hooks/use-popup-commands.hook.js';
import { usePopupDebugLog } from '@hooks/use-popup-debug-log.hook.js';
import { usePopupGlobalState } from '@hooks/use-popup-global-state.hook.js';
import styles from '@/popup/app.module.css';

/**
 * Popup root — composes header, status, controls, sources, tracklist, and debug.
 */
export function App() {
  const { displayedLogs, log, copyLogs, extensionVersion } = usePopupDebugLog();
  const { globalState, refresh, isRefreshing } = usePopupGlobalState({ log });
  const commands = usePopupCommands({ log, refresh });

  const currentPriority = globalState?.currentPriority ?? null;
  const sources = globalState?.sources ?? [];

  return (
    <div className={styles.root}>
      <PopupHeader version={extensionVersion} />
      <SystemStatus
        globalState={globalState}
        isRefreshing={isRefreshing}
        onRefresh={() => {
          void refresh();
        }}
        onSeek={commands.sendGlobalSeek}
      />
      <GlobalControls
        currentPriority={currentPriority}
        globalState={globalState}
        commands={commands}
      />
      <SourcesList
        sources={sources}
        globalState={globalState}
        commands={commands}
      />
      <TracklistShell
        globalState={globalState}
        currentPriority={currentPriority}
        commands={commands}
      />
      <DebugLogPanel logs={displayedLogs} onCopy={copyLogs} />
      <footer className={styles.footer}>
        <strong>CACP - Universal Audio Control</strong>
        <br />
        Multi-tab media detection and priority management
        <br />
        <small>Supports SoundCloud, YouTube</small>
      </footer>
    </div>
  );
}
