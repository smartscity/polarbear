export type TranslationErrorCode = "bundledModelMissing" | "bundledModelInvalid" | "translationFailed" | "timeout";

export class TranslationError extends Error {
  constructor(readonly code: TranslationErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "TranslationError";
  }
}
