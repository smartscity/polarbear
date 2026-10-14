# Bundled English to Chinese translation

These are the same byte-identical compressed model files shipped by Polarbear
Vocab. No runtime model download or Apple language pack is required.

- Engine: BrowserMT Bergamot Translator 0.4.9 (MPL-2.0).
- Model: Mozilla Firefox Translations / Bergamot English to Chinese (MPL-2.0).
- Original model source:
  https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/
- Model project and license: https://github.com/mozilla/translations
- Engine source: https://github.com/browsermt/bergamot-translator
- JavaScript package source: https://github.com/browsermt/bergamot-translator/tree/main/wasm
- Decompression: fflate 0.8.3 (MIT), https://github.com/101arrowz/fflate.
  Its license accompanies the runtime as `fflate-LICENSE.txt`.

The models are unmodified except for gzip packaging. The packaged `manifest.json` records
compressed and decompressed SHA-256 digests. Production builds verify both;
the runtime verifies decompressed assets before loading them into the engine.
Its source is `src/features/vocab/translation/modelManifest.json`.
The MPL license is included as `LICENSE-MPL-2.0.txt`. Engine notices accompany
the runtime under `/translation-runtime/`. This is neural translation, not a
dictionary: acronyms, specialist terms and context-dependent prose can be
translated inaccurately. Dictionary IPA and senses remain owned by Vocab.
