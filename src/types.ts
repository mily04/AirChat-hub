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
  publicIdentity?: E2EEPublicIdentity;
  identitySignature?: string;
  identitySignedAt?: number;
  identityVerified?: boolean;
}

export interface E2EEPublicIdentity {
  algorithm: 'nacl-box-ed25519-v1';
  keyId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
}

export interface E2EEPayload {
  version: 'airchat-e2ee-v1';
  algorithm: 'NACL-BOX-CURVE25519+XSALSA20-POLY1305';
  ciphertext: string;
  iv: string;
  senderKeyId: string;
  receiverKeyId: string;
  messageId: string;
  timestamp: number;
  signature: string;
}

export interface Attachment {
  url: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadId?: string;
  fileId?: string;
  chunkSize?: number;
  totalChunks?: number;
  encrypted?: boolean;
  encryption?: {
    algorithm: string;
    keyId?: string;
    iv?: string;
  };
  integrity?: {
    algorithm: string;
    chunkHashes?: string[];
    fileHash?: string;
  };
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string; // 'global', socket id, or group id
  type: 'text' | 'file' | 'system';
  content: string; // text or JSON string of Attachment for file
  timestamp: number;
  isEncrypted?: boolean;
  encryption?: E2EEPayload;
  encryptionStatus?: 'encrypted' | 'decrypted' | 'missing-key' | 'decrypt-failed' | 'identity-invalid';
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
