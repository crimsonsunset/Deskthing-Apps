import type { usePopupCommands } from '@hooks/use-popup-commands.hook.js';
import type { GlobalState, SourceListItem } from '@/types/popup-global-state.types.js';
import { NoSourcesEmpty } from '@components/no-sources-empty.component.js';
import { SourceItem } from '@components/source-item.component.js';
import styles from '@components/sources-list.module.css';

type PopupCommands = ReturnType<typeof usePopupCommands>;

export type SourcesListProps = {
  sources: SourceListItem[];
  globalState: GlobalState | null;
  commands: PopupCommands;
};

/**
 * Scrollable list of active media source tabs.
 */
export function SourcesList({ sources, globalState, commands }: SourcesListProps) {
  return (
    <section className={styles.sourcesSection} aria-label="Active media sources">
      <div className={styles.sourcesHeader}>🎵 Active Media Sources</div>
      <div className={styles.sourcesList}>
        {sources.length === 0 || !globalState ? (
          <NoSourcesEmpty />
        ) : (
          sources.map((source) => (
            <SourceItem
              key={source.tabId ?? `${source.site}-${source.priority}`}
              source={source}
              globalState={globalState}
              commands={commands}
            />
          ))
        )}
      </div>
    </section>
  );
}
