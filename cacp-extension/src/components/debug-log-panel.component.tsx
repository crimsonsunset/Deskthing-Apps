import { useState } from 'react';

import styles from './debug-log-panel.module.css';

export type DebugLogPanelProps = {
  logs: string[];
  onCopy: () => void;
};

/**
 * Collapsible debug log panel with clipboard copy.
 */
export function DebugLogPanel({ logs, onCopy }: DebugLogPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const logText = logs.length > 0 ? logs.join('\n') : 'No logs yet...';

  return (
    <section className={styles.debugSection} aria-label="Debug logs">
      <button
        type="button"
        className={styles.debugToggle}
        onClick={() => {
          setIsExpanded((previous) => !previous);
        }}
      >
        🔧 Debug Logs
      </button>
      {isExpanded ? (
        <div className={styles.debugInfo}>
          <div className={styles.logWrapper}>
            <pre className={styles.logs}>{logText}</pre>
            <button
              type="button"
              className={styles.copyButton}
              title="Copy all logs"
              onClick={onCopy}
            >
              📋
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
