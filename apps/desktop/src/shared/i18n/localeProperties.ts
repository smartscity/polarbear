export type LocaleMessages = Readonly<Record<string, string>>;

/**
 * Parses Polarbear locale files. The format intentionally stays small:
 * one `key=value` entry per line, with `#` and `!` comments.
 */
export function parseLocaleProperties(source: string): LocaleMessages {
  const messages: Record<string, string> = {};

  source.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith("#") || trimmedLine.startsWith("!")) {
      return;
    }

    const separatorIndex = findSeparator(rawLine);
    if (separatorIndex < 0) {
      throw new Error(`Invalid locale entry on line ${lineIndex + 1}. Expected key=value.`);
    }

    const key = unescapeValue(rawLine.slice(0, separatorIndex).trim());
    if (!key) {
      throw new Error(`Invalid locale entry on line ${lineIndex + 1}. The key is empty.`);
    }
    if (Object.hasOwn(messages, key)) {
      throw new Error(`Duplicate locale key "${key}" on line ${lineIndex + 1}.`);
    }

    messages[key] = unescapeValue(rawLine.slice(separatorIndex + 1).trimStart());
  });

  return messages;
}

function findSeparator(line: string): number {
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "=") {
      return index;
    }
  }
  return -1;
}

function unescapeValue(value: string): string {
  return value.replace(/\\([\\=!#nrt])/g, (_match, token: string) => {
    switch (token) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return token;
    }
  });
}
