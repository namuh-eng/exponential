import {
  canManageInitiativeSettings,
  mergeWorkspaceInitiativeSettings,
  readWorkspaceInitiativeSettings,
  validateWorkspaceInitiativeSettingsPatch,
} from "@/lib/initiative-settings";
import { describe, expect, it } from "vitest";

describe("workspace initiative settings helpers", () => {
  it("reads defaults and persisted settings", () => {
    expect(readWorkspaceInitiativeSettings({})).toEqual({
      enabled: true,
      projectRollups: true,
      visibility: "workspace",
      roadmapMode: "all",
    });

    expect(
      readWorkspaceInitiativeSettings({
        features: {
          initiatives: {
            enabled: false,
            projectRollups: false,
            visibility: "teams",
            roadmapMode: "selected",
          },
        },
      }),
    ).toEqual({
      enabled: false,
      projectRollups: false,
      visibility: "teams",
      roadmapMode: "selected",
    });
  });

  it("merges without dropping unrelated workspace settings", () => {
    expect(
      mergeWorkspaceInitiativeSettings(
        { region: "United States", features: { api: { enabled: true } } },
        {
          enabled: false,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
      ),
    ).toEqual({
      region: "United States",
      features: {
        api: { enabled: true },
        initiatives: {
          enabled: false,
          projectRollups: true,
          visibility: "workspace",
          roadmapMode: "all",
        },
      },
    });
  });

  it("validates patch values and manager roles", () => {
    expect(
      validateWorkspaceInitiativeSettingsPatch({ visibility: "private" }),
    ).toEqual({
      error: "Visibility must be workspace or teams",
    });
    expect(
      validateWorkspaceInitiativeSettingsPatch({ enabled: false }),
    ).toEqual({
      settings: { enabled: false },
    });
    expect(canManageInitiativeSettings("owner")).toBe(true);
    expect(canManageInitiativeSettings("admin")).toBe(true);
    expect(canManageInitiativeSettings("member")).toBe(false);
  });
});
