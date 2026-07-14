import type { AppCommand } from "./appCommandTypes";

/**
 * Commands whose complete behavior is a Markdown document transaction. Keeping
 * this explicit prevents unrelated future format commands from being routed to
 * the text formatter merely because their id starts with `format.`.
 */
export const MARKDOWN_FORMAT_COMMANDS = [
  "format.paragraph",
  "format.heading1",
  "format.heading2",
  "format.heading3",
  "format.heading4",
  "format.heading5",
  "format.heading6",
  "format.bold",
  "format.italic",
  "format.underline",
  "format.code",
  "format.link",
  "format.clearFormat",
  "format.codeFence",
  "format.mathBlock",
  "format.quote",
  "format.orderedList",
  "format.unorderedList",
  "format.taskList",
] as const satisfies readonly AppCommand[];

export type MarkdownFormatCommand = typeof MARKDOWN_FORMAT_COMMANDS[number];

const markdownFormatCommandSet = new Set<AppCommand>(MARKDOWN_FORMAT_COMMANDS);

export function isMarkdownFormatCommand(
  command: AppCommand,
): command is MarkdownFormatCommand {
  return markdownFormatCommandSet.has(command);
}
