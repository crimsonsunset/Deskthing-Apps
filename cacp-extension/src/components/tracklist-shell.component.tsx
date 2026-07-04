import { TracklistPanel } from 'cacp-ui';

import {
  canLookupSource,
} from '@hooks/use-popup-global-state.hook.js';
import type { usePopupCommands } from '@hooks/use-popup-commands.hook.js';
import type { GlobalState, MediaSource } from '@/types/popup-global-state.types.js';
import styles from '@components/tracklist-shell.module.css';

type PopupCommands = ReturnType<typeof usePopupCommands>;

export type TracklistShellProps = {
  globalState: GlobalState | null;
  currentPriority: MediaSource | null;
  commands: PopupCommands;
};

/**
 * Thin wrapper wiring popup commands to the shared TracklistPanel.
 */
export function TracklistShell({
  globalState,
  currentPriority,
  commands,
}: TracklistShellProps) {
  const tracklistState = globalState?.tracklistState ?? {
    status: 'idle' as const,
    error: null,
    result: null,
  };
  const canLookup = canLookupSource(currentPriority);
  const isLookupLoading = tracklistState.status === 'loading';
  const canSeek = Boolean(currentPriority?.isActive && currentPriority?.canControl);
  const progressMs = (currentPriority?.currentTime ?? 0) * 1000;
  const mixDurationSeconds = currentPriority?.duration ?? null;

  return (
    <div className={styles.shell}>
      <TracklistPanel
        status={tracklistState.status}
        result={tracklistState.result}
        error={tracklistState.error}
        progressMs={progressMs}
        mixDurationSeconds={mixDurationSeconds}
        idleMessage="Auto-lookup runs on long mixes. Or hit Lookup current mix."
        lookupActions={
          <button
            type="button"
            className={styles.lookupBtn}
            disabled={!canLookup || isLookupLoading}
            onClick={() => {
              void commands.sendGlobalLookup();
            }}
          >
            {isLookupLoading ? 'Looking up…' : 'Lookup current mix'}
          </button>
        }
        onSeekToTrack={
          canSeek
            ? (track) => {
                if (track.cueSeconds == null) {
                  return;
                }

                void commands.sendGlobalSeek(track.cueSeconds);
              }
            : undefined
        }
      />
    </div>
  );
}
