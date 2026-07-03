import { ProgressBar } from 'cacp-ui';
import styles from './app.module.css';

/**
 * Popup root shell — full UI wiring lands in Phase 4–6.
 */
export function App() {
  return (
    <div className={styles.root}>
      <p className={styles.loading}>Popup loading...</p>
      {/* ponytail: hidden smoke render — verifies cacp-ui workspace + CSS Modules in extension Vite build */}
      <div aria-hidden="true" className={styles.workspaceSmoke}>
        <ProgressBar progressMs={0} durationMs={1} onSeek={() => {}} />
      </div>
    </div>
  );
}
