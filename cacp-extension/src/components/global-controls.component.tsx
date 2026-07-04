import { canLikeSource } from '@hooks/use-popup-global-state.hook.js';
import type { GlobalState, MediaSource } from '@/types/popup-global-state.types.js';
import type { usePopupCommands } from '@hooks/use-popup-commands.hook.js';
import styles from '@components/global-controls.module.css';

type PopupCommands = ReturnType<typeof usePopupCommands>;

export type GlobalControlsProps = {
  currentPriority: MediaSource | null;
  globalState: GlobalState | null;
  commands: PopupCommands;
};

/**
 * Global transport and favorite controls for the priority source.
 */
export function GlobalControls({
  currentPriority,
  globalState,
  commands,
}: GlobalControlsProps) {
  const hasActivePriority = Boolean(currentPriority?.isActive);
  const isPlaying = Boolean(currentPriority?.isPlaying);
  const canLike = canLikeSource(currentPriority);
  const isFavoriteLoading = globalState?.favoriteStatus === 'loading';

  return (
    <section className={styles.globalControls} aria-label="Global controls">
      <button
        type="button"
        title="Previous (Priority Source)"
        disabled={!hasActivePriority}
        onClick={() => {
          void commands.sendGlobalCommand('previous');
        }}
      >
        ⏮️
      </button>
      {isPlaying ? (
        <button
          type="button"
          title="Pause (Priority Source)"
          disabled={!hasActivePriority}
          onClick={() => {
            void commands.sendGlobalCommand('pause');
          }}
        >
          ⏸️
        </button>
      ) : (
        <button
          type="button"
          title="Play (Priority Source)"
          disabled={!hasActivePriority}
          onClick={() => {
            void commands.sendGlobalCommand('play');
          }}
        >
          ▶️
        </button>
      )}
      <button
        type="button"
        title="Next (Priority Source)"
        disabled={!hasActivePriority}
        onClick={() => {
          void commands.sendGlobalCommand('next');
        }}
      >
        ⏭️
      </button>
      <button
        type="button"
        className={styles.favoriteBtn}
        title={isFavoriteLoading ? 'Liking…' : 'Like on SoundCloud'}
        disabled={!canLike || isFavoriteLoading}
        onClick={() => {
          void commands.sendGlobalLike();
        }}
      >
        ♥
      </button>
    </section>
  );
}
