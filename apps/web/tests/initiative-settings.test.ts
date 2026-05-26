import {
  DEFAULT_WORKSPACE_INITIATIVE_SETTINGS,
  mergeWorkspaceInitiativeSettings,
  readWorkspaceInitiativeSettings,
  validateWorkspaceInitiativeSettingsPatch,
} from "@/lib/initiative-settings";
import { describe, expect, it } from "vitest";

describe("workspace initiative settings", () => {
  it("reads defaults and ignores invalid stored values", () => {
    expect(readWorkspaceInitiativeSettings({})).toEqual(
      DEFAULT_WORKSPACE_INITIATIVE_SETTINGS,
    );
    expect(
      readWorkspaceInitiativeSettings({
        features: {
          initiatives: {
            enabled: false,
            projectRollups: "yes",
            visibility: "private",
            roadmapMode: "selected",
          },
        },
      }),
    ).toEqual({
      enabled: false,
      projectRollups: true,
      visibility: "workspace",
      roadmapMode: "selected",
    });
  });

  it("merges settings without dropping sibling feature settings", () => {
    expect(
      mergeWorkspaceInitiativeSettings(
        { plan: "pro", features: { cycles: { enabled: true } } },
        {
          enabled: false,
          projectRollups: false,
          visibility: "teams",
          roadmapMode: "selected",
        },
      ),
    ).toEqual({
      plan: "pro",
      features: {
        cycles: { enabled: true },
        initiatives: {
          enabled: false,
          projectRollups: false,
          visibility: "teams",
          roadmapMode: "selected",
        },
      },
    });
  });

  it("validates supported patch fields", () => {
    expect(
      validateWorkspaceInitiativeSettingsPatch({
        enabled: false,
        projectRollups: false,
        visibility: "teams",
        roadmapMode: "selected",
      }),
    ).toEqual({
      settings: {
        enabled: false,
        projectRollups: false,
        visibility: "teams",
        roadmapMode: "selected",
      },
    });
    expect(
      validateWorkspaceInitiativeSettingsPatch({ enabled: "false" }),
    ).toEqual({ error: "Initiative availability must be a boolean" });
    expect(
      validateWorkspaceInitiativeSettingsPatch({ visibility: "guest" }),
    ).toEqual({ error: "Visibility must be workspace or teams" });
  });
});
