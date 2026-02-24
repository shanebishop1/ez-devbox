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
});
