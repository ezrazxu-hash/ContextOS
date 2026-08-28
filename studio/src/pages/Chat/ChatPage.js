import { createMessageCard } from "../../features/conversation/MessageCard.js";
import { createChatStreamState } from "../../features/conversation/useChatStream.js";

export const ChatPage = {
  kind: "studio-page",
  name: "Chat",
};

export function createChatPage(apiClient, sessionId) {
  const stream = createChatStreamState();
  const state = {
    messages: [],
  };

  return {
    async rehydrate() {
      const response = await apiClient.fetchSessionMessages(sessionId);
      state.messages = (response.messages ?? []).filter((message) => !isDeleted(message));
      return {
        sessionId,
        cards: cards(state),
      };
    },
    applyStreamEvent(event) {
      return stream.applyEvent(event).map(createMessageCard);
    },
    async editMessage(messageId, content, options = {}) {
      const saveEdit = apiClient.patchMessage ?? apiClient.saveMessageEdit;
      const response = await saveEdit(messageId, {
        new_content: content,
        reason: options.reason,
      });
      const updatedMessage = response.message ?? {
        ...state.messages.find((message) => message.id === messageId),
        content,
        revision_id: response.revision_id,
        user_modified: true,
      };
      state.messages = state.messages.map((message) => (message.id === messageId ? updatedMessage : message)).filter((message) => !isDeleted(message));
      return {
        sessionId,
        cards: cards(state),
        impact: response.impact ?? null,
      };
    },
    async deleteMessage(messageId) {
      const removeMessage = apiClient.deleteMessage ?? apiClient.softDeleteMessage;
      const response = await removeMessage(messageId);
      const deletedIds = new Set(response.message_ids ?? response.messageIds ?? [messageId]);
      state.messages = state.messages.filter((message) => !deletedIds.has(message.id));
      return {
        sessionId,
        cards: cards(state),
        deletedMessageIds: [...deletedIds],
      };
    },
  };
}

function cards(state) {
  return state.messages.map(createMessageCard);
}

function isDeleted(message) {
  return Boolean(message.is_deleted ?? message.isDeleted);
}
