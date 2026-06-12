import { create } from 'zustand';

export const useChatStore = create((set) => ({
  currentConversation: null,
  messages: [],
  onlineUsers: [],
  setCurrentConversation: (conversation) => set({ currentConversation: conversation }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setOnlineUsers: (users) => set({ onlineUsers: users }),
}));
