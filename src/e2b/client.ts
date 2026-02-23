export interface E2BClient {
  sdk: "e2b";
}

export function createE2BClient(): E2BClient {
  return { sdk: "e2b" };
}
