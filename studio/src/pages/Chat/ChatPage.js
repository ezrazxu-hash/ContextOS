import { createMessageCard } from "../../features/conversation/MessageCard.js";
import { createChatStreamState } from "../../features/conversation/useChatStream.js";

export const ChatPage = {
  kind: "studio-page",
  name: "Chat",
};

export function createChatPage(apiClient, sessionId) {
  const stream = createChatStreamState();

  return {
    async rehydrate() {
      const response = await apiClient.fetchSessionMessages(sessionId);
      const messages = response.messages ?? [];
      const cards = messages.map(createMessageCard);
      return {
        sessionId,
        cards,
      };
    },
    applyStreamEvent(event) {
      return stream.applyEvent(event).map(createMessageCard);
    },
  };
}
