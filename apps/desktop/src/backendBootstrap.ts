import type * as ChildProcess from "node:child_process";

export const DESKTOP_BACKEND_BOOTSTRAP_FD = 3;
export const DESKTOP_BACKEND_CHILD_STDIO: ChildProcess.StdioOptions = [
  "ignore",
  "pipe",
  "pipe",
  "pipe",
];

export interface DesktopBackendBootstrapPayload {
  readonly mode: "desktop";
  readonly noBrowser: true;
  readonly port: number;
  readonly host?: string;
  readonly t3Home: string;
  readonly authToken: string;
  readonly desktopBootstrapToken?: string;
  readonly otlpTracesUrl?: string;
  readonly otlpMetricsUrl?: string;
}

type WritableBootstrapStream = Pick<NodeJS.WritableStream, "write" | "end">;

function isWritableBootstrapStream(value: unknown): value is WritableBootstrapStream {
  return (
    typeof value === "object" &&
    value !== null &&
    "write" in value &&
    typeof value.write === "function" &&
    "end" in value &&
    typeof value.end === "function"
  );
}

export function createDesktopBackendEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    T3CODE_BOOTSTRAP_FD: String(DESKTOP_BACKEND_BOOTSTRAP_FD),
  };
}

export function createDesktopBackendBootstrapPayload(input: {
  readonly port: number;
  readonly host?: string;
  readonly t3Home: string;
  readonly authToken: string;
  readonly desktopBootstrapToken?: string;
  readonly otlpTracesUrl?: string;
  readonly otlpMetricsUrl?: string;
}): DesktopBackendBootstrapPayload {
  return {
    mode: "desktop",
    noBrowser: true,
    port: input.port,
    ...(input.host ? { host: input.host } : {}),
    t3Home: input.t3Home,
    authToken: input.authToken,
    ...(input.desktopBootstrapToken ? { desktopBootstrapToken: input.desktopBootstrapToken } : {}),
    ...(input.otlpTracesUrl ? { otlpTracesUrl: input.otlpTracesUrl } : {}),
    ...(input.otlpMetricsUrl ? { otlpMetricsUrl: input.otlpMetricsUrl } : {}),
  };
}

export function getDesktopBackendBootstrapStream(input: {
  readonly stdio: ReadonlyArray<unknown>;
}): WritableBootstrapStream | null {
  const bootstrapStream = input.stdio[DESKTOP_BACKEND_BOOTSTRAP_FD];
  if (isWritableBootstrapStream(bootstrapStream)) {
    return bootstrapStream;
  }
  return null;
}
