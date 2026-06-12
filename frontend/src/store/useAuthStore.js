import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user: JSON.parse(localStorage.getItem('chat-user')) || null,
  token: localStorage.getItem('chat-token') || null,
  login: (userData, token) => {
    localStorage.setItem('chat-user', JSON.stringify(userData));
    localStorage.setItem('chat-token', token);
    set({ user: userData, token });
  },
  logout: () => {
    localStorage.removeItem('chat-user');
    localStorage.removeItem('chat-token');
    set({ user: null, token: null });
  },
  updateUser: (userData, token) => {
    localStorage.setItem('chat-user', JSON.stringify(userData));
    localStorage.setItem('chat-token', token);
    set({ user: userData, token });
  },
}));
