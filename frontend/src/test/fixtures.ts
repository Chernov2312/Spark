export interface TestUser {
  id: string;
  username: string;
  tag: string;
  email: string;
}

export interface TestAttachment {
  id: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  file_size?: number;
  text?: string | null;
}

export interface TestMessage {
  id: string;
  chat_id: string;
  user_id: string;
  text: string | null;
  created_at: string;
  attachments: TestAttachment[];
  poll_id?: string | null;
  thread_root_id?: string | null;
  thread_reply_count?: number;
  reply_to_id?: string | null;
  reply_to_text?: string | null;
  is_pinned?: boolean;
  is_forwarded?: boolean;
}

export interface TestChat {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  avatar_urls: string[];
  created_at: string;
  avatar_url?: string | null;
  personal_avatar_url?: string | null;
  last_message?: TestMessage | null;
}

export interface TestPoll {
  id: string;
  message_id: string;
  chat_id: string;
  question: string;
  is_anonymous: boolean;
  allow_retract: boolean;
  is_quiz: boolean;
  is_creator: boolean;
  total_votes: number;
  my_option_id: string | null;
  correct_option_id: string | null;
  version: number;
  options: Array<{
    id: string;
    text: string;
    votes_count: number;
    voters: Array<Pick<TestUser, "id" | "username" | "tag">> | null;
  }>;
}

export const testUser: TestUser = {
  id: "user-1", username: "tester", tag: "tester", email: "tester@example.test",
};

export function makeMessage(overrides: Partial<TestMessage> = {}): TestMessage {
  return {
    id: "message-1", chat_id: "chat-1", user_id: testUser.id,
    text: "Сообщение", created_at: "2026-01-01T12:00:00Z",
    attachments: [], is_pinned: false, poll_id: null, ...overrides,
  };
}

export function makeChat(overrides: Partial<TestChat> = {}): TestChat {
  return {
    id: "chat-1", title: "Тестовый чат", description: "",
    owner_id: "owner-2", avatar_urls: [], created_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

export function makePoll(overrides: Partial<TestPoll> = {}): TestPoll {
  return {
    id: "poll-1", message_id: "message-1", chat_id: "chat-1", question: "Что выбираем?",
    is_anonymous: true, allow_retract: true, is_quiz: false, is_creator: false,
    total_votes: 0, my_option_id: null, correct_option_id: null, version: 1,
    options: [
      { id: "option-1", text: "Первый", votes_count: 0, voters: null },
      { id: "option-2", text: "Второй", votes_count: 0, voters: null },
    ], ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
