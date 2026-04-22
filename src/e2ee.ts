/*
 * Copyright (C) 2026 mily04
 * This file is part of AirChat.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

import nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import { E2EEPayload, E2EEPublicIdentity, Profile, User } from './types';

const DB_NAME = 'airchat-e2ee';
const DB_VERSION = 2;
const STORE_NAME = 'identities';
const TEXT_ENCODING = 'utf-8';
const IDENTITY_ALGORITHM = 'nacl-box-ed25519-v1';

interface StoredIdentity {
  profileId: string;
  algorithm: typeof IDENTITY_ALGORITHM;
  keyId: string;
  signingPublicKey: string;
  signingSecretKey: string;
  encryptionPublicKey: string;
  encryptionSecretKey: string;
}

export interface LocalE2EEIdentity {
  profileId: string;
  keyId: string;
  signingPublicKey: Uint8Array;
  signingSecretKey: Uint8Array;
  encryptionPublicKey: Uint8Array;
  encryptionSecretKey: Uint8Array;
  publicIdentity: E2EEPublicIdentity;
}

export interface JoinIdentityProof {
  publicIdentity: E2EEPublicIdentity;
  identitySignature: string;
  identitySignedAt: number;
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

function openCryptoDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'profileId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withIdentityStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T> | T) {
  const db = await openCryptoDb();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const result = await run(tx.objectStore(STORE_NAME));
    if (mode === 'readwrite') await transactionDone(tx);
    return result;
  } finally {
    db.close();
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function keyIdForSigningPublicKey(signingPublicKey: string) {
  return sha256(signingPublicKey).slice(0, 24);
}

function publicIdentityFromRecord(record: StoredIdentity): E2EEPublicIdentity {
  return {
    algorithm: record.algorithm,
    keyId: record.keyId,
    signingPublicKey: record.signingPublicKey,
    encryptionPublicKey: record.encryptionPublicKey,
  };
}

function recordToIdentity(record: StoredIdentity): LocalE2EEIdentity {
  return {
    profileId: record.profileId,
    keyId: record.keyId,
    signingPublicKey: base64ToBytes(record.signingPublicKey),
    signingSecretKey: base64ToBytes(record.signingSecretKey),
    encryptionPublicKey: base64ToBytes(record.encryptionPublicKey),
    encryptionSecretKey: base64ToBytes(record.encryptionSecretKey),
    publicIdentity: publicIdentityFromRecord(record),
  };
}

function generateStoredIdentity(profileId: string): StoredIdentity {
  const signingPair = nacl.sign.keyPair();
  const encryptionPair = nacl.box.keyPair();
  const signingPublicKey = bytesToBase64(signingPair.publicKey);

  return {
    profileId,
    algorithm: IDENTITY_ALGORITHM,
    keyId: keyIdForSigningPublicKey(signingPublicKey),
    signingPublicKey,
    signingSecretKey: bytesToBase64(signingPair.secretKey),
    encryptionPublicKey: bytesToBase64(encryptionPair.publicKey),
    encryptionSecretKey: bytesToBase64(encryptionPair.secretKey),
  };
}

function joinSigningText(profile: Profile, publicIdentity: E2EEPublicIdentity, signedAt: number) {
  return [
    'airchat-join-v2',
    profile.id,
    profile.username,
    profile.avatar || '',
    profile.color,
    publicIdentity.algorithm,
    publicIdentity.keyId,
    publicIdentity.signingPublicKey,
    publicIdentity.encryptionPublicKey,
    String(signedAt),
  ].join('|');
}

function encryptedMessageSigningText(params: {
  payload: E2EEPayload;
  senderId: string;
  receiverId: string;
}) {
  const { payload, senderId, receiverId } = params;
  return [
    payload.version,
    payload.algorithm,
    payload.messageId,
    senderId,
    receiverId,
    String(payload.timestamp),
    payload.senderKeyId,
    payload.receiverKeyId,
    payload.iv,
    payload.ciphertext,
  ].join('|');
}

function signText(secretKey: Uint8Array, text: string) {
  const signature = nacl.sign.detached(new TextEncoder().encode(text), secretKey);
  return bytesToBase64(signature);
}

function verifyText(publicKey: string, signature: string, text: string) {
  return nacl.sign.detached.verify(new TextEncoder().encode(text), base64ToBytes(signature), base64ToBytes(publicKey));
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  const record = value as Partial<StoredIdentity> | null;
  return Boolean(
    record &&
    record.algorithm === IDENTITY_ALGORITHM &&
    record.keyId &&
    record.signingPublicKey &&
    record.signingSecretKey &&
    record.encryptionPublicKey &&
    record.encryptionSecretKey,
  );
}

export async function ensureE2EEIdentity(profile: Profile): Promise<LocalE2EEIdentity> {
  const existing = await withIdentityStore<unknown>('readonly', (store) => requestToPromise(store.get(profile.id)));
  if (isStoredIdentity(existing)) return recordToIdentity(existing);

  const created = generateStoredIdentity(profile.id);
  await withIdentityStore('readwrite', (store) => {
    store.put(created);
  });
  return recordToIdentity(created);
}

export async function buildJoinIdentityProof(profile: Profile, identity: LocalE2EEIdentity): Promise<JoinIdentityProof> {
  const identitySignedAt = Date.now();
  const identitySignature = signText(identity.signingSecretKey, joinSigningText(profile, identity.publicIdentity, identitySignedAt));
  return {
    publicIdentity: identity.publicIdentity,
    identitySignature,
    identitySignedAt,
  };
}

export async function encryptPrivateText(params: {
  plaintext: string;
  sender: Profile;
  receiver: User;
  identity: LocalE2EEIdentity;
}) {
  const { plaintext, sender, receiver, identity } = params;
  if (!receiver.publicIdentity?.encryptionPublicKey) throw new Error('Receiver has no published encryption key.');

  const messageId = `${Date.now().toString(36)}${bytesToBase64(nacl.randomBytes(8)).replace(/[^a-zA-Z0-9]/g, '')}`;
  const timestamp = Date.now();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    base64ToBytes(receiver.publicIdentity.encryptionPublicKey),
    identity.encryptionSecretKey,
  );

  const payload: E2EEPayload = {
    version: 'airchat-e2ee-v1',
    algorithm: 'NACL-BOX-CURVE25519+XSALSA20-POLY1305',
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(nonce),
    senderKeyId: identity.keyId,
    receiverKeyId: receiver.publicIdentity.keyId,
    messageId,
    timestamp,
    signature: '',
  };
  payload.signature = signText(identity.signingSecretKey, encryptedMessageSigningText({ payload, senderId: sender.id, receiverId: receiver.id }));

  return payload;
}

export async function decryptPrivateText(params: {
  message: {
    senderId: string;
    receiverId: string;
    encryption?: E2EEPayload;
  };
  currentProfileId: string;
  peer: User;
  identity: LocalE2EEIdentity;
}) {
  const { message, currentProfileId, peer, identity } = params;
  const payload = message.encryption;
  if (!payload) throw new Error('Missing encrypted payload.');
  if (!peer.publicIdentity?.encryptionPublicKey || !peer.publicIdentity.signingPublicKey) {
    throw new Error('Peer has no published encryption key.');
  }
  if (peer.publicIdentity.keyId !== payload.senderKeyId && peer.publicIdentity.keyId !== payload.receiverKeyId) {
    throw new Error('Peer identity does not match the encrypted message key ids.');
  }
  if (currentProfileId === message.receiverId && identity.keyId !== payload.receiverKeyId) {
    throw new Error('Local identity does not match recipient key id.');
  }
  if (currentProfileId === message.senderId && identity.keyId !== payload.senderKeyId) {
    throw new Error('Local identity does not match sender key id.');
  }

  const signerIdentity = currentProfileId === message.senderId ? identity.publicIdentity : peer.publicIdentity;
  const signatureOk = verifyText(
    signerIdentity.signingPublicKey,
    payload.signature,
    encryptedMessageSigningText({ payload, senderId: message.senderId, receiverId: message.receiverId }),
  );
  if (!signatureOk) throw new Error('Encrypted message signature is invalid.');

  const plaintext = nacl.box.open(
    base64ToBytes(payload.ciphertext),
    base64ToBytes(payload.iv),
    base64ToBytes(peer.publicIdentity.encryptionPublicKey),
    identity.encryptionSecretKey,
  );
  if (!plaintext) throw new Error('Encrypted private message could not be opened.');

  return new TextDecoder(TEXT_ENCODING).decode(plaintext);
}

export const e2eeInternals = {
  stableStringify,
};
