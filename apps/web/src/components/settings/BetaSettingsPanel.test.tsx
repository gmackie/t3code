import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: () => null,
  useSidebarV2Enabled: () => false,
  useUpdateClientSettings: () => vi.fn(),
}));

vi.mock("../ProjectSessionImportWizard", () => ({
  ProjectSessionImportWizard: () => null,
}));

vi.mock("../ui/input", () => ({ Input: (props: object) => <input {...props} /> }));
vi.mock("../ui/switch", () => ({ Switch: (props: object) => <button {...props} /> }));
vi.mock("../ui/button", () => ({ Button: (props: object) => <button {...props} /> }));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  SettingsSection: ({ children, title }: { children: ReactNode; title: string }) => (
    <section aria-label={title}>{children}</section>
  ),
  SettingsRow: ({
    control,
    description,
    title,
  }: {
    control?: ReactNode;
    description: ReactNode;
    title: ReactNode;
  }) => (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
      {control}
    </div>
  ),
}));
vi.mock("./settingsSearch", () => ({
  searchableSetting: (id: string) => ({
    id,
    title: id === "project-session-import" ? "Project and session import" : id,
  }),
}));

import { BetaSettingsPanel } from "./BetaSettingsPanel";

describe("BetaSettingsPanel", () => {
  it("offers the project and session import wizard", () => {
    const markup = renderToStaticMarkup(<BetaSettingsPanel />);

    expect(markup).toContain("Project and session import");
    expect(markup).toContain('aria-label="Open project and session import wizard"');
  });
});
