import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { chats as chatsApi, social as socialApi } from "../api";
import "../styles/social-sidebar.css";
import { messagePreview, messageTimestamp, summarizeMessageText } from "../utils/messagePreview";

export default function SocialSidebar({
  chats,
  friends,
  setFriends,
  chatsLoading,
  chatsError,
  chatId,
  navigate,
  onCreateChat,
  threads = [],
  threadsLoading = false,
  threadsError = "",
  activeThreadId,
  onOpenThread,
  mode = "chats",
  onModeChange,
  mobileOpen = false,
  onCloseMobile,
}) {
  const [tab, setTab] = useState("chats");
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [friendCategories, setFriendCategories] = useState([]);
  const [chatFolders, setChatFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [friendQuery, setFriendQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupError, setGroupError] = useState("");

  const applyFriends = useCallback((friendData) => {
    setFriends(friendData.friends);
    setRequests(friendData.requests);
    setSentRequests(friendData.sentRequests);
    setFriendCategories(friendData.categories);
  }, [setFriends]);

  async function refresh() {
    applyFriends(await socialApi.listFriends());
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      socialApi.listFriends().then((data) => { if (!cancelled) applyFriends(data); }),
      socialApi.listChatFolders().then((folders) => { if (!cancelled) setChatFolders(folders); }),
    ])
      .catch((cause) => {
        if (!cancelled) {
          setError(cause.response?.data?.detail || "Не удалось загрузить друзей и группы");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applyFriends]);

  useEffect(() => {
    const query = friendQuery.trim();
    if (tab !== "friends" || query.length < 2) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await chatsApi.searchUsersByUsername(query);
        if (!cancelled) {
          const excluded = new Set([
            ...friends.map((friend) => friend.id),
            ...requests.map((friend) => friend.id),
            ...sentRequests.map((friend) => friend.id),
          ]);
          setSearchResults(results.filter((person) => !excluded.has(person.id)));
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, friendQuery, friends, requests, sentRequests]);

  const shownChats = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = chats.filter((chat) => (chat.title || "").toLowerCase().includes(query));
    if (folderFilter === "all") return matching;
    if (folderFilter === "uncategorized") {
      const assigned = new Set(chatFolders.flatMap((folder) => folder.chat_ids));
      return matching.filter((chat) => !assigned.has(chat.id));
    }
    const folder = chatFolders.find((item) => item.id === folderFilter);
    return matching.filter((chat) => folder?.chat_ids.includes(chat.id));
  }, [chats, chatFolders, folderFilter, search]);

  const shownFriends = useMemo(() => {
    const query = search.trim().toLowerCase();
    return friends.filter((friend) => {
      const categoryMatches = categoryFilter === "all"
        || (categoryFilter === "uncategorized"
          ? !friend.category_id
          : friend.category_id === categoryFilter);
      const searchMatches = !query
        || friend.username.toLowerCase().includes(query)
        || friend.tag.toLowerCase().includes(query);
      return categoryMatches && searchMatches;
    });
  }, [friends, categoryFilter, search]);

  const chatGroups = useMemo(() => {
    if (folderFilter !== "all") {
      const folder = chatFolders.find((item) => item.id === folderFilter);
      return [{
        id: folderFilter,
        name: folderFilter === "uncategorized" ? "Без папки" : folder?.name || "Чаты",
        chats: shownChats,
      }];
    }
    const groups = chatFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      chats: shownChats.filter((chat) => folder.chat_ids.includes(chat.id)),
    }));
    const assigned = new Set(chatFolders.flatMap((folder) => folder.chat_ids));
    groups.push({
      id: "uncategorized",
      name: "Без папки",
      chats: shownChats.filter((chat) => !assigned.has(chat.id)),
    });
    return groups;
  }, [chatFolders, folderFilter, shownChats]);

  const friendGroups = useMemo(() => {
    if (categoryFilter !== "all") {
      const category = friendCategories.find((item) => item.id === categoryFilter);
      return [{
        id: categoryFilter,
        name: categoryFilter === "uncategorized" ? "Без категории" : category?.name || "Друзья",
        friends: shownFriends,
      }];
    }
    const groups = friendCategories.map((category) => ({
      id: category.id,
      name: category.name,
      friends: shownFriends.filter((friend) => friend.category_id === category.id),
    }));
    groups.push({
      id: "uncategorized",
      name: "Без категории",
      friends: shownFriends.filter((friend) => !friend.category_id),
    });
    return groups;
  }, [friendCategories, categoryFilter, shownFriends]);

  async function createGroup(event) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    try {
      if (tab === "friends") {
        const category = await socialApi.createFriendCategory(name);
        setFriendCategories((items) => [...items, category]);
      } else {
        const folder = await socialApi.createChatFolder(name);
        setChatFolders((items) => [...items, folder]);
      }
      setGroupName("");
      setGroupError("");
      setGroupFormOpen(false);
    } catch (cause) {
      setGroupError(cause.response?.data?.detail || "Не удалось создать группу");
    }
  }

  async function assignChat(chat, folderId) {
    try {
      await socialApi.setChatFolder(chat.id, folderId);
      setChatFolders((items) => items.map((folder) => ({
        ...folder,
        chat_ids: folder.id === folderId
          ? [...new Set([...folder.chat_ids, chat.id])]
          : folder.chat_ids.filter((id) => id !== chat.id),
      })));
    } catch (cause) {
      setError(cause.response?.data?.detail || "Не удалось переместить чат");
    }
  }

  async function assignFriend(friend, categoryId) {
    try {
      await socialApi.setFriendCategory(friend.id, categoryId);
      setFriends((items) => items.map((item) => (
        item.id === friend.id ? { ...item, category_id: categoryId || null } : item
      )));
    } catch (cause) {
      setError(cause.response?.data?.detail || "Не удалось изменить категорию");
    }
  }

  async function sendRequest(personId) {
    try {
      const result = await socialApi.requestFriend(personId);
      await refresh();
      if (result.status === "accepted") setCategoryFilter("all");
      setFriendQuery("");
      setSearchResults([]);
    } catch (cause) {
      setError(cause.response?.data?.detail || "Не удалось отправить заявку");
    }
  }

  async function acceptRequest(personId) {
    try {
      await socialApi.acceptFriend(personId);
      await refresh();
    } catch (cause) {
      setError(cause.response?.data?.detail || "Не удалось принять заявку");
    }
  }

  return (
    <aside className={`chats-sidebar ${chatId ? "chats-sidebar--hidden-mobile" : ""} ${mobileOpen ? "chats-sidebar--show-mobile" : ""}`}>
      <div className="sidebar-scope" role="tablist" aria-label="Чаты и треды">
        <button type="button" role="tab" aria-selected={mode === "chats"} onClick={() => onModeChange?.("chats")}>Все чаты</button>
        <button type="button" role="tab" aria-selected={mode === "threads"} disabled={!chatId} onClick={() => onModeChange?.("threads")}>Треды этого чата</button>
        {mobileOpen && <button type="button" aria-label="Закрыть боковую панель" onClick={onCloseMobile}>×</button>}
      </div>
      {mode === "threads" ? <>
        <h3 className="sidebar-thread-heading">Треды: {chats.find((chat) => chat.id === chatId)?.title}</h3>
        {threadsLoading && <p className="chats-empty">Загрузка тредов…</p>}
        {threadsError && <p className="social-sidebar-error" role="alert">{threadsError}</p>}
        <ul className="chats-list sidebar-threads">
          {threads.map((thread) => <li key={thread.id}>
            <button type="button" className={activeThreadId === thread.id ? "is-active" : ""} onClick={() => { onOpenThread(thread); onCloseMobile?.(); }}>
              <span>{summarizeMessageText(thread.text) || "Тред с вложением"}</span>
              <small>{thread.thread_reply_count || 0} ответов</small>
            </button>
          </li>)}
          {!threadsLoading && !threadsError && !threads.length && <li className="chats-empty">Тредов пока нет. Откройте меню сообщения и выберите «Открыть тред».</li>}
        </ul>
      </> : <>
      <div className="chats-sidebar__header">
        <input className="chats-search" type="search" placeholder={tab === "chats" ? "Поиск чатов" : "Поиск друзей"} value={search} onChange={(event) => setSearch(event.target.value)} />
        {tab === "chats" && <button className="chats-new" type="button" title="Создать чат" aria-label="Создать чат" onClick={onCreateChat}>+</button>}
      </div>

      <div className="chats-sidebar-tabs" role="tablist" aria-label="Разделы">
        <button type="button" role="tab" aria-selected={tab === "chats"} className={tab === "chats" ? "is-active" : ""} onClick={() => setTab("chats")}>Чаты <span>{chats.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "is-active" : ""} onClick={() => setTab("friends")}>Друзья <span>{friends.length}</span></button>
      </div>

      <div className="sidebar-groups">
        <div className="sidebar-groups__filters">
          {tab === "chats" ? <>
            <button type="button" className={folderFilter === "all" ? "is-active" : ""} onClick={() => setFolderFilter("all")}>Все</button>
            {chatFolders.map((folder) => <button key={folder.id} type="button" className={folderFilter === folder.id ? "is-active" : ""} onClick={() => setFolderFilter(folder.id)}>{folder.name}</button>)}
            <button type="button" className={folderFilter === "uncategorized" ? "is-active" : ""} onClick={() => setFolderFilter("uncategorized")}>Без папки</button>
          </> : <>
            <button type="button" className={categoryFilter === "all" ? "is-active" : ""} onClick={() => setCategoryFilter("all")}>Все</button>
            {friendCategories.map((category) => <button key={category.id} type="button" className={categoryFilter === category.id ? "is-active" : ""} onClick={() => setCategoryFilter(category.id)}>{category.name}</button>)}
            <button type="button" className={categoryFilter === "uncategorized" ? "is-active" : ""} onClick={() => setCategoryFilter("uncategorized")}>Без категории</button>
          </>}
        </div>
        <button className="sidebar-groups__add" type="button" title={tab === "chats" ? "Создать папку" : "Создать категорию"} aria-label={tab === "chats" ? "Создать папку чатов" : "Создать категорию друзей"} onClick={() => { setGroupError(""); setGroupFormOpen((open) => !open); }}>+</button>
      </div>

      {groupFormOpen && <form className="sidebar-group-form" onSubmit={createGroup}>
        <input autoFocus maxLength={40} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder={tab === "chats" ? "Название папки" : "Название категории"} aria-label="Название группы" />
        <button type="submit">Создать</button>
        {groupError && <span role="alert">{groupError}</span>}
      </form>}

      {error && <p className="social-sidebar-error" role="alert">{error}</p>}
      {tab === "friends" && loading && <p className="chats-empty">Загрузка…</p>}
      {tab === "chats" && chatsLoading && <p className="chats-empty">Загрузка чатов…</p>}
      {tab === "chats" && chatsError && <p className="social-sidebar-error" role="alert">{chatsError}</p>}

      {!chatsLoading && !chatsError && tab === "chats" && <ul className="chats-list">
        {chatGroups.map((group) => group.chats.length > 0 && <Fragment key={group.id}>
          {folderFilter === "all" && <li className="sidebar-group-heading"><span>{group.name}</span><span>{group.chats.length}</span></li>}
          {group.chats.map((chat) => {
            const folder = chatFolders.find((item) => item.chat_ids.includes(chat.id));
            return <li key={chat.id} className={`chat-item ${chatId === chat.id ? "chat-item--active" : ""}`} onClick={() => navigate(`/chats/${chat.id}`)}>
              <div className="chat-item__avatar">
                {chat.personal_avatar_url || chat.avatar_urls?.at(-1)
                  ? <img src={chat.personal_avatar_url || chat.avatar_urls.at(-1)} alt="" />
                  : chat.title?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="chat-item__body">
                <div className="chat-item__top"><span className="chat-item__title">{chat.title}</span>
                  {messageTimestamp(chat.last_message?.created_at) > 0 && <time className="chat-item__time" dateTime={chat.last_message.created_at} title={new Date(messageTimestamp(chat.last_message.created_at)).toLocaleString("ru-RU")}>
                    {new Date(messageTimestamp(chat.last_message.created_at)).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </time>}
                </div>
                <div className="chat-item__bottom">
                  <span className="chat-item__preview" title={messagePreview(chat.last_message)}>{messagePreview(chat.last_message)}</span>
                  <select className="chat-item__folder" aria-label={`Папка для чата ${chat.title}`} value={folder?.id || ""} onClick={(event) => event.stopPropagation()} onChange={(event) => assignChat(chat, event.target.value)}>
                    <option value="">Без папки</option>
                    {chatFolders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>
              </div>
            </li>;
          })}
        </Fragment>)}
        {shownChats.length === 0 && <li className="chats-empty">{search ? "Ничего не найдено" : "Пока нет чатов"}</li>}
      </ul>}

      {!loading && tab === "friends" && <div className="friends-list">
        <label className="friend-search"><span>Добавить друга</span><input value={friendQuery} onChange={(event) => { setFriendQuery(event.target.value); setSearchResults([]); setSearching(false); }} placeholder="Имя или @тег" /></label>
        {searching && <p className="friends-list__hint">Ищем пользователей…</p>}
        {searchResults.map((person) => <div className="friend-item" key={person.id}>
          <div className="friend-avatar">{person.username?.[0]?.toUpperCase()}</div>
          <div className="friend-item__identity"><strong>{person.username}</strong><span>@{person.tag}</span></div>
          <button type="button" onClick={() => sendRequest(person.id)}>Добавить</button>
        </div>)}
        {requests.length > 0 && <section className="friend-requests"><h3>Входящие заявки · {requests.length}</h3>
          {requests.map((person) => <div className="friend-item" key={person.id}>
            <div className="friend-avatar">{person.username?.[0]?.toUpperCase()}</div>
            <div className="friend-item__identity"><strong>{person.username}</strong><span>@{person.tag}</span></div>
            <button type="button" onClick={() => acceptRequest(person.id)}>Принять</button>
          </div>)}
        </section>}
        {sentRequests.length > 0 && <section className="friend-requests friend-requests--sent"><h3>Отправленные заявки · {sentRequests.length}</h3>
          {sentRequests.map((person) => <div className="friend-item" key={person.id}>
            <div className="friend-avatar">{person.username?.[0]?.toUpperCase()}</div>
            <div className="friend-item__identity"><strong>{person.username}</strong><span>@{person.tag}</span></div>
            <span className="friend-request-status">Заявка отправлена</span>
          </div>)}
        </section>}
        {friendGroups.map((group) => group.friends.length > 0 && <section className="friend-group" key={group.id}>
          {categoryFilter === "all" && <h3 className="sidebar-group-heading"><span>{group.name}</span><span>{group.friends.length}</span></h3>}
          {group.friends.map((person) => <div className="friend-item" key={person.id}>
            <div className="friend-avatar">{person.username?.[0]?.toUpperCase()}</div>
            <div className="friend-item__identity"><strong>{person.username}</strong><span>@{person.tag}</span></div>
            <select aria-label={`Категория для ${person.username}`} value={person.category_id || ""} onChange={(event) => assignFriend(person, event.target.value)}>
              <option value="">Без категории</option>
              {friendCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>)}
        </section>)}
        {shownFriends.length === 0 && searchResults.length === 0 && <p className="chats-empty">{friends.length ? "В этой группе пока нет друзей" : "Пока нет друзей — найдите человека по имени или тегу"}</p>}
      </div>}
      </>}
    </aside>
  );
}
