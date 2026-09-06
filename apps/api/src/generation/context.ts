export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export const MAX_CONTEXT_CHARACTERS = 24_000;

export function trimConversationContext(
  messages: readonly ConversationMessage[],
  maximumCharacters = MAX_CONTEXT_CHARACTERS,
): ConversationMessage[] {
  if (!Number.isInteger(maximumCharacters) || maximumCharacters <= 0) {
    throw new Error("maximumCharacters must be a positive integer.");
  }

  const selectedMessages: ConversationMessage[] = [];
  let characterCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (!message) {
      continue;
    }

    if (characterCount + message.content.length > maximumCharacters) {
      break;
    }

    selectedMessages.unshift({ ...message });
    characterCount += message.content.length;
  }

  return selectedMessages;
}
