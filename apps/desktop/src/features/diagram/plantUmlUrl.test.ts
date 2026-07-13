import { describe, expect, it } from "vitest";
import { encodePlantUmlSource, plantUmlSvgUrl } from "./plantUmlUrl";

describe("PlantUML URL encoding", () => {
  it("encodes PlantUML source as UTF-8 hex", () => {
    expect(encodePlantUmlSource("A")).toBe("~h41");
    expect(encodePlantUmlSource("中")).toBe("~he4b8ad");
  });

  it("appends the encoded source to the configured render endpoint", () => {
    expect(plantUmlSvgUrl("https://example.test/svg/", "A")).toBe(
      "https://example.test/svg/~h41",
    );
  });
});
