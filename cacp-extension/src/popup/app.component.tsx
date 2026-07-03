import { ProgressBar } from 'cacp-ui';

import { usePopupCommands } from '../hooks/use-popup-commands.hook.js';
import { usePopupDebugLog } from '../hooks/use-popup-debug-log.hook.js';
import { usePopupGlobalState } from '../hooks/use-popup-global-state.hook.js';
import styles from './app.module.css';

/**
 * Popup root shell — full UI wiring lands in Phase 5–6.
 */
export function App() {
  const { displayedLogs, log, extensionVersion } = usePopupDebugLog();
  const { globalState, refresh, isRefreshing } = usePopupGlobalState({ log });
  usePopupCommands({ log, refresh });

  return (
    <div className={styles.root}>
      <p className={styles.loading}>
        v{extensionVersion} · {isRefreshing ? 'Refreshing…' : 'Ready'} ·{' '}
        {globalState?.totalSources ?? 0} source(s)
      </p>
      {/* ponytail: hidden smoke render — verifies cacp-ui workspace + CSS Modules in extension Vite build */}
      <div aria-hidden="true" className={styles.workspaceSmoke}>
        <ProgressBar progressMs={0} durationMs={1} onSeek={() => {}} />
      </div>
      <pre aria-hidden="true" className={styles.logSmoke}>
        {displayedLogs.join('\n')}
      </pre>
    </div>
  );
}
