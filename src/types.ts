/*
 * Copyright (C) 2026 mily04
 * This file is part of AirChat.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

export interface Profile {
  id: string; // The persistent User ID generated locally
  username: string;
  avatar: string | null;
  color: string;
  isAnonymous?: boolean;
}

export interface User {
  id: string; // the persistent userId passed to the backend
  username: string;
  avatar: string | null;
  color: string;
  isOnline?: boolean;
}

export interface Attachment {
  url: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string; // 'global', socket id, or group id
  type: 'text' | 'file' | 'system';
  content: string; // text or JSON string of Attachment for file
  timestamp: number;
}

export interface Group {
  id: string;
  name: string;
  members: string[]; // array of user IDs
}

export interface GroupInvite {
  groupId: string;
  name: string;
  inviterId: string;
}
