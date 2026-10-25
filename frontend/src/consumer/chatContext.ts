// What the visitor can currently see, summarised in plain text for the assistant.
// Only public, on-screen information goes here — never hidden answers.
let current = "The visitor is on the HeatHunter home page.";

export function setChatContext(text: string) {
  current = text;
}

export function getChatContext(): string {
  return current;
}
