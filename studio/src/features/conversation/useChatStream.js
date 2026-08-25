import { createChatStreamReducer } from "../../client/chatStream.js";

export function createChatStreamState(initialMessages = []) {
  const reducer = createChatStreamReducer(initialMessages);

  return {
    get messages() {
      return reducer.messages;
    },
    applyEvent(event) {
      return reducer.apply(event);
    },
  };
}
