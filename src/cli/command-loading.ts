import { logger } from "../logging/logger.js";

const ANSI_GREEN = "\u001b[32m";
const ANSI_RESET = "\u001b[0m";

interface LoadingStageControllerOptions {
  enabled: boolean;
  showCompletion: boolean;
  honorForceColor?: boolean;
}

interface LoadingStageController {
  clear: () => void;
  finish: () => void;
  setStage: (message: string, completionMessage: string) => void;
}

export function createLoadingStageController(options: LoadingStageControllerOptions): LoadingStageController {
  let stopLoading: (() => void) | undefined;
  let completedStageMessage: string | undefined;

  const clear = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    completedStageMessage = undefined;
  };
  const finish = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    if (completedStageMessage && options.showCompletion) {
      process.stdout.write(`${formatCompletedStage(completedStageMessage, options.honorForceColor)}\n`);
    }
    completedStageMessage = undefined;
  };
  const setStage = (message: string, completionMessage: string): void => {
    if (!options.enabled) {
      return;
    }
    finish();
    completedStageMessage = completionMessage;
    stopLoading = logger.startLoading(message);
  };

  return { clear, finish, setStage };
}

function formatCompletedStage(message: string, honorForceColor = false): string {
  const check = shouldUseColor(process.stdout, honorForceColor) ? `${ANSI_GREEN}✓${ANSI_RESET}` : "✓";
  return `${check} ${message}`;
}

function shouldUseColor(output: NodeJS.WriteStream, honorForceColor: boolean): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  const forceColor = process.env.FORCE_COLOR;
  if (honorForceColor && forceColor !== undefined && forceColor !== "0") {
    return true;
  }
  return output.isTTY === true;
}
