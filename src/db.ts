/*
 * Copyright (C) 2026 mily04
 * This file is part of Tmesh.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

import { Attachment, ChatMessage, Group, Profile, User } from './types';

const DB_NAME = 'tmesh';
const DB_VERSION = 1;
export const MESSAGE_PAGE_SIZE = 80;

type StoreName = 'profiles' | 'users' | 'groups' | 'messages' | 'attachments';

interface UserRecord {
  profileId: string;
  id: string;
  user: User | null;
  deleted: boolean;
}

interface GroupRecord {
  profileId: string;
  id: string;
  group: Group | null;
  deleted: boolean;
}

interface MessageRecord extends ChatMessage {
  profileId: string;
  roomId: string;
}

interface AttachmentRecord extends Attachment {
  profileId: string;
  roomId: string;
  messageId: string;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

function openTmeshDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('profiles')) {
        db.createObjectStore('profiles', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('users')) {
        const store = db.createObjectStore('users', { keyPath: ['profileId', 'id'] });
        store.createIndex('byProfile', 'profileId');
        store.createIndex('byProfileDeleted', ['profileId', 'deleted']);
      }

      if (!db.objectStoreNames.contains('groups')) {
        const store = db.createObjectStore('groups', { keyPath: ['profileId', 'id'] });
        store.createIndex('byProfile', 'profileId');
        store.createIndex('byProfileDeleted', ['profileId', 'deleted']);
      }

      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: ['profileId', 'roomId', 'id'] });
        store.createIndex('byProfile', 'profileId');
        store.createIndex('byRoomTime', ['profileId', 'roomId', 'timestamp']);
      }

      if (!db.objectStoreNames.contains('attachments')) {
        const store = db.createObjectStore('attachments', { keyPath: ['profileId', 'messageId'] });
        store.createIndex('byProfile', 'profileId');
        store.createIndex('byRoom', ['profileId', 'roomId']);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(storeName: StoreName, mode: IDBTransactionMode, run: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T> | T) {
  const db = await openTmeshDb();
  try {
    const tx = db.transaction(storeName, mode);
    const result = await run(tx.objectStore(storeName), tx);
    if (mode === 'readwrite') await transactionDone(tx);
    return result;
  } finally {
    db.close();
  }
}

async function withStores<T>(storeNames: StoreName[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => Promise<T> | T) {
  const db = await openTmeshDb();
  try {
    const tx = db.transaction(storeNames, mode);
    const result = await run(tx);
    if (mode === 'readwrite') await transactionDone(tx);
    return result;
  } finally {
    db.close();
  }
}

async function getAllFromIndex<T>(storeName: StoreName, indexName: string, query: IDBValidKey | IDBKeyRange) {
  return withStore<T[]>(storeName, 'readonly', (store) => requestToPromise(store.index(indexName).getAll(query)));
}

function parseAttachment(content: string): Attachment | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function roomForMessage(msg: ChatMessage, currentProfileId: string) {
  if (msg.type === 'system' || msg.receiverId === 'global') return 'global';
  if (msg.receiverId.startsWith('group_')) return msg.receiverId;
  return msg.senderId === currentProfileId ? msg.receiverId : msg.senderId;
}

function localStorageJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function removeLegacyProfileKeys(profileId: string) {
  [
    `lan_users_${profileId}`,
    `lan_hidden_users_${profileId}`,
    `lan_deleted_users_${profileId}`,
    `lan_groups_${profileId}`,
    `lan_hidden_groups_${profileId}`,
    `lan_deleted_groups_${profileId}`,
    `lan_chats_${profileId}`,
  ].forEach((key) => localStorage.removeItem(key));
}

async function migrateProfileData(profileId: string) {
  const legacyUsers = localStorageJson<Record<string, User>>(`lan_users_${profileId}`);
  const legacyDeletedUsers = localStorageJson<Record<string, true>>(`lan_deleted_users_${profileId}`);
  const legacyGroups = localStorageJson<Record<string, Group>>(`lan_groups_${profileId}`);
  const legacyDeletedGroups = localStorageJson<Record<string, true>>(`lan_deleted_groups_${profileId}`);
  const legacyChats = localStorageJson<Record<string, ChatMessage[]>>(`lan_chats_${profileId}`);

  if (!legacyUsers && !legacyDeletedUsers && !legacyGroups && !legacyDeletedGroups && !legacyChats) {
    localStorage.removeItem(`lan_hidden_users_${profileId}`);
    localStorage.removeItem(`lan_hidden_groups_${profileId}`);
    return;
  }

  await withStores(['users', 'groups', 'messages', 'attachments'], 'readwrite', (tx) => {
    const users = tx.objectStore('users');
    const groups = tx.objectStore('groups');
    const messages = tx.objectStore('messages');
    const attachments = tx.objectStore('attachments');

    Object.values(legacyUsers ?? {}).forEach((user) => {
      users.put({ profileId, id: user.id, user, deleted: false } satisfies UserRecord);
    });
    Object.keys(legacyDeletedUsers ?? {}).forEach((id) => {
      users.put({ profileId, id, user: legacyUsers?.[id] ?? null, deleted: true } satisfies UserRecord);
    });

    Object.values(legacyGroups ?? {}).forEach((group) => {
      groups.put({ profileId, id: group.id, group, deleted: false } satisfies GroupRecord);
    });
    Object.keys(legacyDeletedGroups ?? {}).forEach((id) => {
      groups.put({ profileId, id, group: legacyGroups?.[id] ?? null, deleted: true } satisfies GroupRecord);
    });

    Object.entries(legacyChats ?? {}).forEach(([roomId, roomMessages]) => {
      roomMessages.forEach((msg) => {
        messages.put({ ...msg, profileId, roomId } satisfies MessageRecord);
        if (msg.type === 'file') {
          const attachment = parseAttachment(msg.content);
          if (attachment) attachments.put({ ...attachment, profileId, roomId, messageId: msg.id } satisfies AttachmentRecord);
        }
      });
    });
  });

  removeLegacyProfileKeys(profileId);
}

export const tmeshRepository = {
  roomForMessage,

  async migrateLegacyLocalStorage() {
    const legacyProfiles = localStorageJson<Profile[]>('lan_profiles');
    if (legacyProfiles?.length) {
      await withStore('profiles', 'readwrite', (store) => {
        legacyProfiles.forEach((profile) => store.put(profile));
      });
      for (const profile of legacyProfiles) {
        if (!profile.isAnonymous) await migrateProfileData(profile.id);
      }
      localStorage.removeItem('lan_profiles');
    }
  },

  async getProfiles() {
    await this.migrateLegacyLocalStorage();
    return withStore<Profile[]>('profiles', 'readonly', (store) => requestToPromise(store.getAll()));
  },

  async saveProfile(profile: Profile) {
    await withStore('profiles', 'readwrite', (store) => {
      store.put(profile);
    });
  },

  async deleteProfile(profileId: string) {
    await withStores(['profiles', 'users', 'groups', 'messages', 'attachments'], 'readwrite', async (tx) => {
      tx.objectStore('profiles').delete(profileId);
      await Promise.all([
        deleteByProfile(tx.objectStore('users'), profileId),
        deleteByProfile(tx.objectStore('groups'), profileId),
        deleteByProfile(tx.objectStore('messages'), profileId),
        deleteByProfile(tx.objectStore('attachments'), profileId),
      ]);
    });
    removeLegacyProfileKeys(profileId);
  },

  async getContacts(profileId: string) {
    await migrateProfileData(profileId);
    const [userRecords, groupRecords] = await Promise.all([
      getAllFromIndex<UserRecord>('users', 'byProfile', profileId),
      getAllFromIndex<GroupRecord>('groups', 'byProfile', profileId),
    ]);

    const users: Record<string, User> = {};
    const deletedUsers: Record<string, true> = {};
    userRecords.forEach((record) => {
      if (record.deleted) deletedUsers[record.id] = true;
      else if (record.user) users[record.id] = record.user;
    });

    const groups: Record<string, Group> = {};
    const deletedGroups: Record<string, true> = {};
    groupRecords.forEach((record) => {
      if (record.deleted) deletedGroups[record.id] = true;
      else if (record.group) groups[record.id] = record.group;
    });

    return { users, deletedUsers, groups, deletedGroups };
  },

  async saveUsers(profileId: string, users: User[]) {
    await withStore('users', 'readwrite', (store) => {
      users.forEach((user) => store.put({ profileId, id: user.id, user, deleted: false } satisfies UserRecord));
    });
  },

  async saveGroups(profileId: string, groups: Group[]) {
    await withStore('groups', 'readwrite', (store) => {
      groups.forEach((group) => store.put({ profileId, id: group.id, group, deleted: false } satisfies GroupRecord));
    });
  },

  async markUserDeleted(profileId: string, userId: string) {
    await withStore('users', 'readwrite', (store) => {
      store.put({ profileId, id: userId, user: null, deleted: true } satisfies UserRecord);
    });
  },

  async markGroupDeleted(profileId: string, groupId: string) {
    await withStore('groups', 'readwrite', (store) => {
      store.put({ profileId, id: groupId, group: null, deleted: true } satisfies GroupRecord);
    });
  },

  async addMessage(profileId: string, roomId: string, msg: ChatMessage) {
    await withStores(['messages', 'attachments'], 'readwrite', (tx) => {
      tx.objectStore('messages').put({ ...msg, profileId, roomId } satisfies MessageRecord);
      if (msg.type === 'file') {
        const attachment = parseAttachment(msg.content);
        if (attachment) tx.objectStore('attachments').put({ ...attachment, profileId, roomId, messageId: msg.id } satisfies AttachmentRecord);
      }
    });
  },

  async getRecentMessages(profileId: string, roomId: string, limit = MESSAGE_PAGE_SIZE) {
    return getMessagesPage(profileId, roomId, limit);
  },

  async getMessagesBefore(profileId: string, roomId: string, beforeTimestamp: number, limit = MESSAGE_PAGE_SIZE) {
    return getMessagesPage(profileId, roomId, limit, beforeTimestamp);
  },

  async deleteMessage(profileId: string, roomId: string, messageId: string) {
    await withStores(['messages', 'attachments'], 'readwrite', (tx) => {
      tx.objectStore('messages').delete([profileId, roomId, messageId]);
      tx.objectStore('attachments').delete([profileId, messageId]);
    });
  },

  async deleteRoom(profileId: string, roomId: string) {
    await withStores(['messages', 'attachments'], 'readwrite', async (tx) => {
      await Promise.all([
        deleteByRoom(tx.objectStore('messages'), profileId, roomId),
        deleteByRoom(tx.objectStore('attachments'), profileId, roomId),
      ]);
    });
  },
};

async function getMessagesPage(profileId: string, roomId: string, limit: number, beforeTimestamp?: number) {
  return withStore<{ messages: ChatMessage[]; hasMore: boolean }>('messages', 'readonly', async (store) => {
    const index = store.index('byRoomTime');
    const upperTimestamp = beforeTimestamp === undefined ? Number.MAX_SAFE_INTEGER : beforeTimestamp - 1;
    const range = IDBKeyRange.bound([profileId, roomId, 0], [profileId, roomId, upperTimestamp]);
    const request = index.openCursor(range, 'prev');
    const rows: ChatMessage[] = [];

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve({ messages: rows.reverse(), hasMore: false });
          return;
        }
        if (rows.length >= limit) {
          resolve({ messages: rows.reverse(), hasMore: true });
          return;
        }
        const { profileId: _profileId, roomId: _roomId, ...msg } = cursor.value as MessageRecord;
        rows.push(msg);
        cursor.continue();
      };
    });
  });
}

function deleteByProfile(store: IDBObjectStore, profileId: string) {
  const index = store.index('byProfile');
  return deleteCursorRange(index.openKeyCursor(IDBKeyRange.only(profileId)), store);
}

function deleteByRoom(store: IDBObjectStore, profileId: string, roomId: string) {
  const index = store.name === 'messages' ? store.index('byRoomTime') : store.index('byRoom');
  const range = store.name === 'messages'
    ? IDBKeyRange.bound([profileId, roomId, 0], [profileId, roomId, Number.MAX_SAFE_INTEGER])
    : IDBKeyRange.only([profileId, roomId]);
  return deleteCursorRange(index.openKeyCursor(range), store);
}

function deleteCursorRange(request: IDBRequest<IDBCursor | null>, store: IDBObjectStore) {
  return new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      cursor.continue();
    };
  });
}
