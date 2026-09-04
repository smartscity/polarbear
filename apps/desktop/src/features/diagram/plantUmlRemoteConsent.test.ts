import { describe, expect, it } from "vitest";
import {
  approvePlantUmlRemoteRender,
  hasPlantUmlRemoteRenderApproval,
} from "./plantUmlRemoteConsent";

describe("PlantUML remote render consent", () => {
  it("remembers approval for the same source during the app session", () => {
    const source = "@startuml\nAlice -> Bob: approved\n@enduml";

    expect(hasPlantUmlRemoteRenderApproval(source)).toBe(false);
    approvePlantUmlRemoteRender(source);
    expect(hasPlantUmlRemoteRenderApproval(source)).toBe(true);
  });

  it("does not extend approval to edited source", () => {
    const approvedSource = "@startuml\nAlice -> Bob: original\n@enduml";
    const editedSource = "@startuml\nAlice -> Bob: edited\n@enduml";

    approvePlantUmlRemoteRender(approvedSource);

    expect(hasPlantUmlRemoteRenderApproval(editedSource)).toBe(false);
  });
});
