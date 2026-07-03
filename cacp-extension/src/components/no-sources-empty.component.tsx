import styles from './no-sources-empty.module.css';

/**
 * Empty state when no media tabs are detected.
 */
export function NoSourcesEmpty() {
  return (
    <div className={styles.noSources}>
      <p>🎵 No media detected</p>
      <p>Open a supported music site in any tab to get started!</p>
      <div className={styles.supportedSites}>
        <small>Supported: SoundCloud, YouTube</small>
      </div>
    </div>
  );
}
