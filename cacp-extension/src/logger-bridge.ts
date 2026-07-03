/**
 * Main-world script injection and window.CACP_Logger debug exposure for content scripts.
 */

import type { LoggerInstanceType } from '@crimsonsunset/jsg-logger';
import type { CacpLoggerControls } from './types/window-globals.types.js';

interface LoggerCommandMessage {
  type: 'CACP_LOGGER_COMMAND';
  command: string;
  component?: string;
  level?: string;
}

/**
 * Injects the main-world logger script and exposes jsg-logger controls on window for console debugging.
 * @param logger - The jsg-logger singleton
 */
export function installLoggerBridge(logger: LoggerInstanceType): void {
  (function injectMainWorldScript() {
    try {
      console.log('🚀 [CACP] Injecting main world script...');
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/main-world-logger.ts');
      script.onload = function () {
        console.log('✅ [CACP] Main world script injected successfully');
        script.remove();
      };
      script.onerror = function () {
        console.error('❌ [CACP] Failed to inject main world script');
        script.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (error) {
      console.error('❌ [CACP] Script injection error:', error);
    }
  })();

  console.log('🔧 CACP Logger exposure check:', {
    loggerExists: typeof logger !== 'undefined',
    loggerControls: logger ? typeof logger.controls : 'logger undefined',
    loggerObject: logger ? Object.keys(logger) : 'no logger',
  });

  const exposeLogger = (): boolean => {
    console.log('🔍 Attempting to expose logger controls...');
    console.log('🔍 Logger state:', {
      logger: !!logger,
      controls: logger ? !!logger.controls : false,
      controlsType: logger && logger.controls ? typeof logger.controls : 'none',
      loggerKeys: logger ? Object.keys(logger) : [],
      currentWindowCACP: typeof window.CACP_Logger,
      windowLoggerKeys: Object.keys(window).filter((k) => k.toLowerCase().includes('logger')),
    });

    if (logger && logger.controls && typeof logger.controls === 'object') {
      try {
        window.CACP_Logger = logger.controls as CacpLoggerControls;
        console.log('✅ CACP_Logger exposed via logger.controls');
        console.log('🎛️ Available methods:', Object.keys(logger.controls));

        if (window.CACP_Logger && typeof window.CACP_Logger.enableDebugMode === 'function') {
          console.log('🧪 Logger exposure verification: SUCCESS');
          return true;
        }

        console.error('❌ Logger exposure verification: FAILED', {
          windowCACPLogger: typeof window.CACP_Logger,
          hasEnableDebugMode: window.CACP_Logger
            ? typeof window.CACP_Logger.enableDebugMode
            : 'no CACP_Logger',
        });
        return false;
      } catch (e) {
        console.error('❌ Logger exposure error:', e);
        return false;
      }
    }

    console.warn('❌ Logger controls not available yet', {
      loggerExists: !!logger,
      controlsExists: logger ? !!logger.controls : false,
      controlsType: logger && logger.controls ? typeof logger.controls : 'none',
    });
    return false;
  };

  if (!exposeLogger()) {
    setTimeout(() => {
      if (!exposeLogger()) {
        setTimeout(() => {
          if (!exposeLogger()) {
            console.error('🚨 Failed to expose CACP_Logger after multiple attempts');
            console.log('Debug info:', {
              logger: typeof logger,
              window: typeof window,
            });
          }
        }, 1000);
      }
    }, 100);
  }

  window.exposeCACPLogger = () => {
    console.log('🔧 Manual logger exposure attempt...');

    const normalExposure = exposeLogger();
    if (normalExposure) {
      console.log('✅ Normal exposure worked!');
      return;
    }

    console.log('🔍 Searching for logger objects globally...');
    const globalObjects = Object.keys(window);
    const loggerObjects = globalObjects.filter(
      (key) =>
        key.toLowerCase().includes('logger') ||
        (window[key as keyof Window] &&
          typeof window[key as keyof Window] === 'object' &&
          (window[key as keyof Window] as { controls?: unknown }).controls),
    );

    console.log('Found potential logger objects:', loggerObjects);

    for (const objName of loggerObjects) {
      const obj = window[objName as keyof Window] as { controls?: CacpLoggerControls } | undefined;
      if (obj?.controls && typeof obj.controls.enableDebugMode === 'function') {
        window.CACP_Logger = obj.controls;
        console.log(`✅ CACP_Logger manually exposed via ${objName}!`);
        console.log('🎛️ Available methods:', Object.keys(window.CACP_Logger));
        console.log('Try: CACP_Logger.enableDebugMode() or CACP_Logger.setLevel("soundcloud", "debug")');
        return;
      }
    }

    console.error('❌ Manual logger exposure failed - no suitable objects found');
    console.log('Debug info:', {
      globalLoggerObjects: loggerObjects,
      windowKeys: globalObjects.slice(0, 20),
    });
  };

  window.addEventListener('message', (event: MessageEvent<LoggerCommandMessage>) => {
    if (event.data?.type !== 'CACP_LOGGER_COMMAND') return;

    console.log('🔗 [CACP] Received command from main world:', event.data);

    const { command, component, level } = event.data;

    try {
      switch (command) {
        case 'enableDebugMode':
          if (logger?.controls?.enableDebugMode) {
            logger.controls.enableDebugMode();
            console.log('✅ [CACP] Debug mode enabled via main world command');
          } else {
            console.warn('❌ [CACP] Debug mode not available - logger.controls missing');
          }
          break;

        case 'setLevel':
          if (logger?.controls?.setLevel && component && level) {
            logger.controls.setLevel(component, level);
            console.log(`✅ [CACP] Set ${component} level to ${level} via main world command`);
          } else {
            console.warn('❌ [CACP] setLevel not available or missing parameters:', { component, level });
          }
          break;

        case 'getStatus':
          if (window.cacpMediaSource?.getStatus) {
            const status = window.cacpMediaSource.getStatus();
            console.log('ℹ️ [CACP] Current status:', status);
          } else {
            console.warn('❌ [CACP] getStatus not available');
          }
          break;

        default:
          console.warn('❓ [CACP] Unknown command from main world:', command);
      }
    } catch (error) {
      console.error('❌ [CACP] Error handling main world command:', error);
    }
  });

  console.log('🔗 [CACP] Main world message listener installed');
}
