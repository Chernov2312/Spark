import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, vi } from "vitest";
import ChatsPage from "../pages/ChatsPage.jsx";
import { makeChat, makeMessage, testUser } from "./fixtures";

interface SocketOptions {
  onEvent: (event: string, data: Record<string, unknown>) => void;
  onOpen?: () => void;
}

const { apiMocks, socialMocks, socketState } = vi.hoisted(() => ({
  apiMocks: {
    listChats: vi.fn(),
    listMessages: vi.fn(),
    transcribeAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    getAttachmentDownloadUrl: vi.fn(),
    sendMessage: vi.fn(),
    togglePin: vi.fn(),
    listPinnedMessages: vi.fn(),
    searchMessages: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listThreads: vi.fn(),
    listThreadMessages: vi.fn(),
    forwardMessage: vi.fn(),
    addReaction: vi.fn(),
    setPersonalChatAvatar: vi.fn(),
    resetPersonalChatAvatar: vi.fn(),
    getChatMembers: vi.fn(),
    addUsersToChat: vi.fn(),
    leaveChat: vi.fn(),
    deleteChat: vi.fn(),
    searchUsersByUsername: vi.fn(),
    markChatRead: vi.fn(),
    updateMemberRole: vi.fn(),
    createChat: vi.fn(),
    uploadChatAvatars: vi.fn(),
    createPoll: vi.fn(),
    getPoll: vi.fn(),
    voteInPoll: vi.fn(),
    retractPollVote: vi.fn(),
  },
  socialMocks: {
    listFriends: vi.fn(),
    acceptFriend: vi.fn(),
    listChatFolders: vi.fn(),
  },
  socketState: {
    options: null as SocketOptions | null,
    connections: new Map<string, SocketOptions>(),
  },
}));

vi.mock("../api", () => ({
  chats: {
    listChats: apiMocks.listChats,
    setPersonalChatAvatar: apiMocks.setPersonalChatAvatar,
    resetPersonalChatAvatar: apiMocks.resetPersonalChatAvatar,
    getChatMembers: apiMocks.getChatMembers,
    addUsersToChat: apiMocks.addUsersToChat,
    leaveChat: apiMocks.leaveChat,
    deleteChat: apiMocks.deleteChat,
    searchUsersByUsername: apiMocks.searchUsersByUsername,
    markChatRead: apiMocks.markChatRead,
    updateMemberRole: apiMocks.updateMemberRole,
    createChat: apiMocks.createChat,
    uploadChatAvatars: apiMocks.uploadChatAvatars,
  },
  social: socialMocks,
  polls: { createPoll: apiMocks.createPoll, getPoll: apiMocks.getPoll, vote: apiMocks.voteInPoll, retractVote: apiMocks.retractPollVote },
  messages: {
    listMessages: apiMocks.listMessages,
    sendMessage: apiMocks.sendMessage,
    transcribeAttachment: apiMocks.transcribeAttachment,
    togglePin: apiMocks.togglePin,
    listPinnedMessages: apiMocks.listPinnedMessages,
    searchMessages: apiMocks.searchMessages,
    updateMessage: apiMocks.updateMessage,
    deleteMessage: apiMocks.deleteMessage,
    listThreads: apiMocks.listThreads,
    listThreadMessages: apiMocks.listThreadMessages,
    forwardMessage: apiMocks.forwardMessage,
    addReaction: apiMocks.addReaction,
  },
  attachments: {
    uploadAttachment: apiMocks.uploadAttachment,
    getAttachmentDownloadUrl: apiMocks.getAttachmentDownloadUrl,
  },
  auth: {
    isAuthenticated: () => true,
    getCurrentUser: () => testUser,
  },
  createChatSocket: vi.fn((chatId: string, options: SocketOptions) => {
    socketState.options = options;
    socketState.connections.set(chatId, options);
    return { close: vi.fn(), send: vi.fn() };
  }),
  translateApiError: (_error: unknown, fallback: string) => fallback,
}));

export { apiMocks, socialMocks, socketState };
export const chat = makeChat();
export const audioMessage = makeMessage({ text: null, attachments: [{
  id: "attachment-1", file_key: "https://storage.test/audio.ogg", file_name: "audio.ogg",
  mime_type: "audio/ogg", file_size: 12, text: null,
}] });

export function renderChat(initialPath = `/chats/${chat.id}`, strict = false) {
  const app = (
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/chats/:chatId" element={<ChatsPage />} />
        <Route path="/chats" element={<ChatsPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{app}</StrictMode> : app);
}

export function setupChatTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    socketState.connections.clear();
    socketState.options = null;
    for (const mock of [...Object.values(apiMocks), ...Object.values(socialMocks)]) mock.mockReset();
    localStorage.clear();
    localStorage.setItem("access_token", "test-token");
    localStorage.setItem("user", JSON.stringify(testUser));
    apiMocks.listChats.mockResolvedValue([chat]);
    apiMocks.getChatMembers.mockResolvedValue([]);
    apiMocks.markChatRead.mockResolvedValue({});
    apiMocks.listMessages.mockResolvedValue([audioMessage]);
    apiMocks.listPinnedMessages.mockResolvedValue([]);
    apiMocks.listThreads.mockResolvedValue([]);
    apiMocks.listThreadMessages.mockResolvedValue([audioMessage]);
    socialMocks.listFriends.mockResolvedValue({
      friends: [],
      requests: [],
      sentRequests: [],
      categories: [],
    });
    socialMocks.listChatFolders.mockResolvedValue([]);
    apiMocks.transcribeAttachment.mockResolvedValue({ queued: true });
    apiMocks.getAttachmentDownloadUrl.mockResolvedValue(
      "https://storage.test/download/audio.ogg",
    );
    apiMocks.uploadAttachment.mockImplementation(async (file) => ({
      id: `uploaded-${file.name}`,
      file_key: `https://storage.test/${file.name}`,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      text: null,
    }));
    apiMocks.sendMessage.mockImplementation(async (chatId, body) => ({
      id: "sent-message",
      chat_id: chatId,
      user_id: "user-1",
      text: body.text,
      attachments: body.attachments || [],
      created_at: "2026-01-01T12:00:00Z",
    }));
    socketState.options = null;
    socketState.connections.clear();
  });
}
