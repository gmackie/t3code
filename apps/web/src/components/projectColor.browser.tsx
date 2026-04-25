import "../index.css";

import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ProjectFavicon } from "./ProjectFavicon";
import { ProjectNameBadge } from "./chat/ChatHeader";

describe("project color rendering", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the selected project color for the folder icon", async () => {
    const screen = await render(
      <ProjectFavicon
        environmentId={EnvironmentId.make("environment-local")}
        cwd="/repo/project"
        projectColor="blue"
      />,
    );

    try {
      const folder = document.querySelector('[data-project-favicon="folder"]');
      expect(folder).not.toBeNull();
      expect(getComputedStyle(folder as Element).color).toBe("rgb(59, 130, 246)");
    } finally {
      await screen.unmount();
    }
  });

  it("uses the selected project color as the thread-title project badge background", async () => {
    const screen = await render(<ProjectNameBadge projectName="t3code" projectColor="green" />);

    try {
      const badge = document.querySelector("[data-project-name-badge]");
      expect(badge).not.toBeNull();
      expect(getComputedStyle(badge as Element).backgroundColor).toBe("rgb(34, 197, 94)");
    } finally {
      await screen.unmount();
    }
  });
});
