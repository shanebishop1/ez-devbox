import { afterEach, describe, expect, it, vi } from "vitest";
import { logger, setVerboseLoggingEnabled } from "../src/logging/logger.js";

function setTty(stream: NodeJS.WriteStream, value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
  Object.defineProperty(stream, "isTTY", {
    configurable: true,
    value
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
      return;
    }

    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value: undefined
    });
  };
}

describe("logger formatting", () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }

    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }

    setVerboseLoggingEnabled(false);

    vi.restoreAllMocks();
  });

  it("logs plain text when output is not a tty", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const restoreStdout = setTty(process.stdout, false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      logger.info("hello");
      expect(logSpy).toHaveBeenCalledWith("[INFO] hello");
    } finally {
      restoreStdout();
    }
  });

  it("colors only the prefix when enabled", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const restoreStdout = setTty(process.stdout, true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      logger.warn("careful");
      expect(logSpy).toHaveBeenCalledWith("\u001b[33m[WARN]\u001b[0m careful");
    } finally {
      restoreStdout();
    }
  });

  it("respects no-color and keeps error logging on stderr", () => {
    process.env.NO_COLOR = "1";
    process.env.FORCE_COLOR = "1";
    const restoreStderr = setTty(process.stderr, true);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      logger.error("boom");
      expect(errorSpy).toHaveBeenCalledWith("[ERROR] boom");
    } finally {
      restoreStderr();
    }
  });

  it("allows forced color when output is not a tty", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const restoreStdout = setTty(process.stdout, false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      logger.info("hello");
      expect(logSpy).toHaveBeenCalledWith("\u001b[36m[INFO]\u001b[0m hello");
    } finally {
      restoreStdout();
    }
  });

  it("suppresses verbose logs by default", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.verbose("hidden");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("prints verbose logs when enabled", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const restoreStdout = setTty(process.stdout, false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    setVerboseLoggingEnabled(true);

    try {
      logger.verbose("detail");
      expect(logSpy).toHaveBeenCalledWith("[INFO] detail");
    } finally {
      restoreStdout();
    }
  });

  it("clears loading line when spinner stops", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const restoreStdout = setTty(process.stdout, true);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.useFakeTimers();

    try {
      const stop = logger.startLoading("Bootstrapping...");
      vi.advanceTimersByTime(90);
      expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Bootstrapping..."));

      const callsBeforeStop = writeSpy.mock.calls.length;
      stop();
      expect(writeSpy).toHaveBeenCalledWith("\r\u001b[2K");

      vi.advanceTimersByTime(500);
      expect(writeSpy.mock.calls.length).toBe(callsBeforeStop + 1);
    } finally {
      vi.useRealTimers();
      writeSpy.mockRestore();
      restoreStdout();
    }
  });

  it("stopping an old spinner does not clear a newer spinner", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    const restoreStdout = setTty(process.stdout, true);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.useFakeTimers();

    try {
      const firstStop = logger.startLoading("One");
      vi.advanceTimersByTime(90);

      const secondStop = logger.startLoading("Two");
      vi.advanceTimersByTime(90);
      const callsBeforeOldStop = writeSpy.mock.calls.length;

      firstStop();
      vi.advanceTimersByTime(200);
      expect(writeSpy.mock.calls.length).toBeGreaterThan(callsBeforeOldStop);

      secondStop();
      expect(writeSpy).toHaveBeenCalledWith("\r\u001b[2K");
    } finally {
      vi.useRealTimers();
      writeSpy.mockRestore();
      restoreStdout();
    }
  });
});
