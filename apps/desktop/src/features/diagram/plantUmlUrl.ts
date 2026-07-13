export function encodePlantUmlSource(source: string): string {
  const bytes = new TextEncoder().encode(source);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `~h${hex}`;
}

export function plantUmlSvgUrl(serverUrl: string, source: string): string {
  return `${serverUrl}${encodePlantUmlSource(source)}`;
}
