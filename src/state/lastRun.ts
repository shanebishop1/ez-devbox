export interface LastRunState {
  sandboxId: string;
  mode: string;
  updatedAt: string;
}

export function createEmptyLastRunState(): LastRunState {
  return {
    sandboxId: "",
    mode: "",
    updatedAt: new Date(0).toISOString()
  };
}
