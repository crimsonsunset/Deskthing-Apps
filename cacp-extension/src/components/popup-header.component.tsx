import styles from '@components/popup-header.module.css';

export type PopupHeaderProps = {
  version: string;
};

/**
 * Popup title bar with extension version.
 */
export function PopupHeader({ version }: PopupHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.logo}>🎯 CACP</div>
      <div className={styles.subtitle}>Global Media Controller</div>
      <div className={styles.version}>v{version}</div>
    </header>
  );
}
