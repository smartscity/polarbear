import type { Translate } from "../../shared/i18n/translate";
import { PlantUmlRenderError } from "./plantUmlRenderer";

export function describePlantUmlRenderError(
  error: unknown,
  t: Translate,
): string {
  if (error instanceof PlantUmlRenderError) {
    if (error.kind === "httpStatus") {
      return t("diagram.plantUmlServerStatus", { status: error.status ?? 0 });
    }
    if (error.kind === "invalidSvg") {
      return t("diagram.plantUmlInvalidResponse");
    }
    return t("diagram.plantUmlTimeout");
  }

  return error instanceof Error
    ? error.message
    : t("diagram.plantUmlRenderError", { error: String(error) });
}
