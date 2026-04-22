/*
 * Copyright (C) 2026 mily04
 * This file is part of AirChat.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

import { E2EEPayload, E2EEPublicIdentity, Profile, User } from './types';

const DB_NAME = 'airchat-e2ee';
const DB_VERSION = 1;
const STORE_NAME = 'identities';
const TEXT_ENCODING = 'utf-8';

interface StoredIdentity {
  profileId: string;
  keyId: string;
  signingPrivateKeyJwk: JsonWebKey;
  signingPublicKeyJwk: JsonWebKey;
  encryptionPrivateKeyJwk: JsonWebKey;
  encryptionPublicKeyJwk: JsonWebKey;
}

export interface LocalE2EEIdentity {
  profileId: string;
  keyId: string;
  signingPrivateKey: CryptoKey;
  signingPublicKey: CryptoKey;
  encryptionPrivateKey: CryptoKey;
  encryptionPublicKey: CryptoKey;
  publicIdentity: E2EEPublicIdentity;
}

export interface JoinIdentityProof {
  publicIdentity: E2EEPublicIdentity;
  identitySignature: string;
  identitySignedAt: number;
}

function assertWebCrypto() {
  if (!crypto?.subtle) {
    throw new Error('Web Crypto API is required for private chat encryption.');
  }
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

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
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

async function importSigningPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
}

async function importSigningPublicKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

async function importEncryptionPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}

async function importEncryptionPublicKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

function publicIdentityFromRecord(record: StoredIdentity): E2EEPublicIdentity {
  return {
    keyId: record.keyId,
    signingPublicKeyJwk: record.signingPublicKeyJwk,
    encryptionPublicKeyJwk: record.encryptionPublicKeyJwk,
  };
}

async function recordToIdentity(record: StoredIdentity): Promise<LocalE2EEIdentity> {
  const [signingPrivateKey, signingPublicKey, encryptionPrivateKey, encryptionPublicKey] = await Promise.all([
    importSigningPrivateKey(record.signingPrivateKeyJwk),
    importSigningPublicKey(record.signingPublicKeyJwk),
    importEncryptionPrivateKey(record.encryptionPrivateKeyJwk),
    importEncryptionPublicKey(record.encryptionPublicKeyJwk),
  ]);

  return {
    profileId: record.profileId,
    keyId: record.keyId,
    signingPrivateKey,
    signingPublicKey,
    encryptionPrivateKey,
    encryptionPublicKey,
    publicIdentity: publicIdentityFromRecord(record),
  };
}

async function generateStoredIdentity(profileId: string): Promise<StoredIdentity> {
  const [signingPair, encryptionPair] = await Promise.all([
    crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
    crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']),
  ]);

  const [signingPrivateKeyJwk, signingPublicKeyJwk, encryptionPrivateKeyJwk, encryptionPublicKeyJwk] = await Promise.all([
    crypto.subtle.exportKey('jwk', signingPair.privateKey),
    crypto.subtle.exportKey('jwk', signingPair.publicKey),
    crypto.subtle.exportKey('jwk', encryptionPair.privateKey),
    crypto.subtle.exportKey('jwk', encryptionPair.publicKey),
  ]);
  const keyId = (await sha256Hex(stableStringify(signingPublicKeyJwk))).slice(0, 24);

  return {
    profileId,
    keyId,
    signingPrivateKeyJwk,
    signingPublicKeyJwk,
    encryptionPrivateKeyJwk,
    encryptionPublicKeyJwk,
  };
}

function joinSigningText(profile: Profile, publicIdentity: E2EEPublicIdentity, signedAt: number) {
  return [
    'airchat-join-v1',
    profile.id,
    profile.username,
    profile.avatar || '',
    profile.color,
    publicIdentity.keyId,
    stableStringify(publicIdentity.signingPublicKeyJwk),
    stableStringify(publicIdentity.encryptionPublicKeyJwk),
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

async function signText(privateKey: CryptoKey, text: string) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text));
  return bytesToBase64(new Uint8Array(signature));
}

async function verifyText(publicKeyJwk: JsonWebKey, signature: string, text: string) {
  const publicKey = await importSigningPublicKey(publicKeyJwk);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64ToBytes(signature), new TextEncoder().encode(text));
}

async function deriveAesKey(privateKey: CryptoKey, peerPublicKeyJwk: JsonWebKey) {
  const peerPublicKey = await importEncryptionPublicKey(peerPublicKeyJwk);
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function ensureE2EEIdentity(profile: Profile): Promise<LocalE2EEIdentity> {
  assertWebCrypto();
  const existing = await withIdentityStore<StoredIdentity | undefined>('readonly', (store) => requestToPromise(store.get(profile.id)));
  if (existing) return recordToIdentity(existing);

  const created = await generateStoredIdentity(profile.id);
  await withIdentityStore('readwrite', (store) => {
    store.put(created);
  });
  return recordToIdentity(created);
}

export async function buildJoinIdentityProof(profile: Profile, identity: LocalE2EEIdentity): Promise<JoinIdentityProof> {
  const identitySignedAt = Date.now();
  const identitySignature = await signText(identity.signingPrivateKey, joinSigningText(profile, identity.publicIdentity, identitySignedAt));
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
  if (!receiver.publicIdentity) throw new Error('Receiver has no published encryption key.');

  const messageId = `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  const timestamp = Date.now();
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(identity.encryptionPrivateKey, receiver.publicIdentity.encryptionPublicKeyJwk);
  const aad = new TextEncoder().encode(`${messageId}|${sender.id}|${receiver.id}|${timestamp}|${identity.keyId}|${receiver.publicIdentity.keyId}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aad },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  const payload: E2EEPayload = {
    version: 'airchat-e2ee-v1',
    algorithm: 'ECDH-P256+AES-GCM',
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(ivBytes),
    senderKeyId: identity.keyId,
    receiverKeyId: receiver.publicIdentity.keyId,
    messageId,
    timestamp,
    signature: '',
  };
  payload.signature = await signText(identity.signingPrivateKey, encryptedMessageSigningText({ payload, senderId: sender.id, receiverId: receiver.id }));

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
  if (!peer.publicIdentity) throw new Error('Peer has no published encryption key.');
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
  const signatureOk = await verifyText(
    signerIdentity.signingPublicKeyJwk,
    payload.signature,
    encryptedMessageSigningText({ payload, senderId: message.senderId, receiverId: message.receiverId }),
  );
  if (!signatureOk) throw new Error('Encrypted message signature is invalid.');

  const aesKey = await deriveAesKey(identity.encryptionPrivateKey, peer.publicIdentity.encryptionPublicKeyJwk);
  const aad = new TextEncoder().encode(`${payload.messageId}|${message.senderId}|${message.receiverId}|${payload.timestamp}|${payload.senderKeyId}|${payload.receiverKeyId}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv), additionalData: aad },
    aesKey,
    base64ToBytes(payload.ciphertext),
  );

  return new TextDecoder(TEXT_ENCODING).decode(plaintext);
}
