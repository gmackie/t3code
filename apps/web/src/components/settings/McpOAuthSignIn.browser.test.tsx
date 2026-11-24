import { EnvironmentId, type McpOAuthSignInEvent } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { McpOAuthSignIn } from "./McpOAuthSignIn";

const prompt = vi.hoisted(() => ({
  type: "authorize" as const,
  authorizationUrl: "https://github.com/login/device",
  userCode: "ABCD-EFGH",
}));
const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("../../localApi", () => ({ ensureLocalApi: () => ({ shell: { openExternal } }) }));
vi.mock("../../state/environments", () => ({
  useEnvironmentHttpBaseUrl: () => "https://t3.example",
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { mcpOAuthSignIn: () => prompt, mcpOAuthSignOut: () => undefined },
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("~/hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn() }),
}));
vi.mock("../../state/query", () => ({
  formatEnvironmentQueryError: () => "",
  useEnvironmentQuery: (event: typeof prompt | null) => ({ data: event }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/waitForQuerySettled", () => ({
  waitForQuerySettled: <A,>(input: {
    settle: (event: McpOAuthSignInEvent) => A | undefined;
    signal: AbortSignal;
  }) => {
    const result = input.settle(prompt);
    return result !== undefined
      ? Promise.resolve(result)
      : new Promise<undefined>((resolve) =>
          input.signal.addEventListener("abort", () => resolve(undefined), { once: true }),
        );
  },
}));

it("shows the GitHub code before the user opens the verification page", async () => {
  openExternal.mockClear();
  await using screen = await render(
    <McpOAuthSignIn
      environmentId={EnvironmentId.make("device-test")}
      projectId={null}
      server="github"
      canManage
      status={{ status: "signed-out" }}
      onChanged={() => undefined}
    />,
  );
  await screen.getByRole("button", { name: "Sign in" }).click();
  await expect.element(screen.getByText(prompt.userCode)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "Copy code & open GitHub" }))
    .toHaveAttribute("href", prompt.authorizationUrl);
  expect(openExternal).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Cancel" }).click();
  await expect.element(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
});
