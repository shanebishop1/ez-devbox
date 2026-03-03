import type { SandboxHandle } from "../e2b/lifecycle.js";

export interface SshBridgeSessionArtifacts {
  sessionDir: string;
  authorizedKeysPath: string;
  hostPrivateKeyPath: string;
  hostPublicKeyPath: string;
  sshdPort: number;
  websockifyPort: number;
  sshdConfigPath: string;
  sshdPidPath: string;
  websockifyPidPath: string;
  websockifyLogPath: string;
}

export interface SshBridgePorts {
  sshdPort: number;
  websockifyPort: number;
}

export interface SshBridgeSession {
  tempDir: string;
  privateKeyPath: string;
  knownHostsPath: string;
  wsUrl: string;
  remoteUser?: string;
  artifacts?: SshBridgeSessionArtifacts;
  startupEnvScriptPath?: string;
}

export interface SshModeDeps {
  isInteractiveTerminal: () => boolean;
  prepareSession: (handle: SandboxHandle) => Promise<SshBridgeSession>;
  runInteractiveSession: (session: SshBridgeSession, remoteCommand: string) => Promise<void>;
  cleanupSession: (handle: SandboxHandle, session: SshBridgeSession) => Promise<void>;
}
