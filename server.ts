/*
 * Copyright (C) 2026 mily04
 * This file is part of AirChat.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import { Bonjour } from 'bonjour-service';

const runtimeDir = typeof __dirname !== 'undefined' ? __dirname : path.join(process.cwd(), 'dist');

if (!process.env.NODE_ENV && (process as any).pkg) {
  process.env.NODE_ENV = 'production';
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
  maxHttpBufferSize: 1e8, // 100 MB for websocket payloads just in case
});

const PORT = 3000;

const DEFAULT_CHUNK_SIZE = Number(process.env.UPLOAD_CHUNK_SIZE || 2 * 1024 * 1024);
const MAX_CHUNK_SIZE = Number(process.env.UPLOAD_MAX_CHUNK_SIZE || 8 * 1024 * 1024);
const MAX_FILE_SIZE = Number(process.env.UPLOAD_MAX_FILE_SIZE || 5 * 1024 * 1024 * 1024);

app.use(express.json({ limit: '1mb' }));

// Setup file uploads setup
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const chunkUploadsDir = path.join(uploadsDir, '.chunks');
if (!fs.existsSync(chunkUploadsDir)) {
  fs.mkdirSync(chunkUploadsDir, { recursive: true });
}

function decodeOriginalFilename(filename: string) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return decoded.includes('�') ? filename : decoded;
}

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'file';
}

function decodeEncodedFilename(encodedName: string, fallback = 'file') {
  if (encodedName) {
    try {
      return sanitizeFilename(decodeURIComponent(encodedName));
    } catch {
      return sanitizeFilename(fallback);
    }
  }
  return sanitizeFilename(fallback);
}

function isSafeUploadId(uploadId: string) {
  return /^[a-zA-Z0-9_-]{12,128}$/.test(uploadId);
}

function parseNonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function getUploadTempDir(uploadId: string) {
  return path.join(chunkUploadsDir, uploadId);
}

function getChunkPath(uploadId: string, chunkIndex: number) {
  return path.join(getUploadTempDir(uploadId), `${chunkIndex}.part`);
}

async function listUploadedChunks(uploadId: string) {
  const uploadDir = getUploadTempDir(uploadId);
  if (!fs.existsSync(uploadDir)) return [];
  const files = await fs.promises.readdir(uploadDir);
  return files
    .map(file => /^(\d+)\.part$/.exec(file)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .sort((a, b) => a - b);
}

function streamFile(source: string, destination: fs.WriteStream) {
  return new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(source);
    input.on('error', reject);
    destination.on('error', reject);
    input.on('end', resolve);
    input.pipe(destination, { end: false });
  });
}

async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

const chunkUpload = multer({
  dest: chunkUploadsDir,
  limits: {
    fileSize: MAX_CHUNK_SIZE,
    files: 1,
  },
});

// Serve uploads
app.use('/uploads', express.static(uploadsDir));

function isPrivateLanAddress(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return false;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isVirtualInterface(name: string) {
  return /tailscale|zerotier|wireguard|vpn|virtualbox|vmware|hyper-v|vethernet|loopback|bluetooth|docker|wsl/i.test(name);
}

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const candidates: { name: string; address: string; score: number }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (isVirtualInterface(name)) continue;
      if (iface.address.startsWith('169.254.')) continue;
      if (!isPrivateLanAddress(iface.address)) continue;

      let score = 0;
      if (/wi-?fi|wlan|ethernet|以太网|无线/i.test(name)) score += 50;
      score += 30;
      if (iface.address.startsWith('192.168.')) score += 10;
      candidates.push({ name, address: iface.address, score });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(candidate => candidate.address);
}

const lanIps = getLanIps();
const localIp = lanIps[0] || '127.0.0.1';
let currentPort = PORT;
const mdnsHostname = 'airchat';

function getAccessUrls(port: number) {
  const urls = [`http://localhost:${port}`];
  lanIps.forEach(ip => urls.push(`http://${ip}:${port}`));
  urls.push(`http://${mdnsHostname}.local:${port}`);
  return urls;
}

app.get('/api/server-info', (req, res) => {
  res.json({
    localIp,
    lanIps,
    port: currentPort,
    mdnsUrl: `http://${mdnsHostname}.local:${currentPort}`,
    appUrl: process.env.APP_URL
  });
});

app.get('/api/upload/config', (req, res) => {
  res.json({
    chunkSize: DEFAULT_CHUNK_SIZE,
    maxChunkSize: MAX_CHUNK_SIZE,
    maxFileSize: MAX_FILE_SIZE,
  });
});

app.get('/api/upload/status', async (req, res) => {
  const uploadId = String(req.query.uploadId || '');
  if (!isSafeUploadId(uploadId)) {
    return res.status(400).json({ error: 'Invalid uploadId' });
  }

  const uploadedChunks = await listUploadedChunks(uploadId);
  res.json({ uploadId, uploadedChunks });
});

app.post('/api/upload/chunk', chunkUpload.single('chunk'), async (req, res) => {
  const uploadId = String(req.body.uploadId || '');
  const chunkIndex = parseNonNegativeInteger(req.body.chunkIndex);
  const totalChunks = parseNonNegativeInteger(req.body.totalChunks);
  const totalSize = parseNonNegativeInteger(req.body.totalSize);
  const declaredChunkSize = parseNonNegativeInteger(req.body.chunkSize);
  const chunkHash = typeof req.body.chunkHash === 'string' ? req.body.chunkHash : '';

  if (!req.file) return res.status(400).json({ error: 'Missing chunk file' });
  if (!isSafeUploadId(uploadId) || chunkIndex === null || totalChunks === null || totalSize === null || declaredChunkSize === null) {
    await fs.promises.rm(req.file.path, { force: true });
    return res.status(400).json({ error: 'Invalid upload metadata' });
  }
  if (totalChunks <= 0 || chunkIndex >= totalChunks || totalSize > MAX_FILE_SIZE || declaredChunkSize > MAX_CHUNK_SIZE || req.file.size > MAX_CHUNK_SIZE) {
    await fs.promises.rm(req.file.path, { force: true });
    return res.status(413).json({ error: 'Upload exceeds configured limits' });
  }
  if (chunkHash) {
    const actualChunkHash = await hashFile(req.file.path);
    if (actualChunkHash !== chunkHash) {
      await fs.promises.rm(req.file.path, { force: true });
      return res.status(400).json({ error: 'Chunk hash mismatch' });
    }
  }

  const uploadDir = getUploadTempDir(uploadId);
  await fs.promises.mkdir(uploadDir, { recursive: true });
  await fs.promises.rename(req.file.path, getChunkPath(uploadId, chunkIndex));

  const uploadedChunks = await listUploadedChunks(uploadId);
  res.json({ uploadId, uploadedChunks, received: chunkIndex });
});

app.post('/api/upload/complete', async (req, res) => {
  const uploadId = String(req.body.uploadId || '');
  const fileId = String(req.body.fileId || uploadId);
  const totalChunks = parseNonNegativeInteger(req.body.totalChunks);
  const totalSize = parseNonNegativeInteger(req.body.totalSize);
  const originalName = decodeEncodedFilename(String(req.body.originalNameEncoded || ''), String(req.body.originalName || 'file'));
  const mimeType = typeof req.body.mimeType === 'string' ? req.body.mimeType : 'application/octet-stream';
  const expectedFileHash = typeof req.body.fileHash === 'string' ? req.body.fileHash : '';

  if (!isSafeUploadId(uploadId) || totalChunks === null || totalSize === null || totalChunks <= 0 || totalSize > MAX_FILE_SIZE) {
    return res.status(400).json({ error: 'Invalid upload completion metadata' });
  }

  const uploadedChunks = await listUploadedChunks(uploadId);
  if (uploadedChunks.length !== totalChunks || uploadedChunks.some((chunk, index) => chunk !== index)) {
    return res.status(409).json({ error: 'Upload is incomplete', uploadedChunks });
  }

  const finalName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${originalName}`;
  const finalPath = path.join(uploadsDir, finalName);
  const output = fs.createWriteStream(finalPath, { flags: 'wx' });

  try {
    for (let i = 0; i < totalChunks; i += 1) {
      await streamFile(getChunkPath(uploadId, i), output);
    }
    await new Promise<void>((resolve, reject) => {
      output.end(resolve);
      output.on('error', reject);
    });

    const stat = await fs.promises.stat(finalPath);
    if (stat.size !== totalSize) {
      await fs.promises.rm(finalPath, { force: true });
      return res.status(400).json({ error: 'Merged file size mismatch' });
    }

    let fileHash = '';
    if (expectedFileHash) {
      fileHash = await hashFile(finalPath);
      if (fileHash !== expectedFileHash) {
        await fs.promises.rm(finalPath, { force: true });
        return res.status(400).json({ error: 'File hash mismatch' });
      }
    }

    await fs.promises.rm(getUploadTempDir(uploadId), { recursive: true, force: true });
    res.json({
      uploadId,
      fileId,
      url: `/uploads/${encodeURIComponent(finalName)}`,
      originalName,
      size: stat.size,
      mimeType,
      fileHash,
    });
  } catch (error) {
    output.destroy();
    await fs.promises.rm(finalPath, { force: true });
    console.error('Failed to complete upload', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Real-time Chat
type PublicIdentity = {
  algorithm: 'nacl-box-ed25519-v1';
  keyId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
};

type ConnectedUser = {
  id: string;
  username: string;
  avatar: string | null;
  color: string;
  socketId: string;
  publicIdentity?: PublicIdentity;
  identitySignature?: string;
  identitySignedAt?: number;
  identityVerified?: boolean;
};

const users = new Map<string, ConnectedUser>();
const activeSockets = new Map<string, string>(); // socketId -> userId
const identityKeyIds = new Map<string, string>(); // userId -> keyId
const groups = new Map<string, { id: string; name: string; members: Set<string> }>();

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function keyIdForSigningPublicKey(signingPublicKey: string) {
  return sha256(signingPublicKey).slice(0, 24);
}

function joinSigningText(userData: {
  id: string;
  username: string;
  avatar: string | null;
  color: string;
  publicIdentity: PublicIdentity;
  identitySignedAt: number;
}) {
  return [
    'airchat-join-v2',
    userData.id,
    userData.username,
    userData.avatar || '',
    userData.color,
    userData.publicIdentity.algorithm,
    userData.publicIdentity.keyId,
    userData.publicIdentity.signingPublicKey,
    userData.publicIdentity.encryptionPublicKey,
    String(userData.identitySignedAt),
  ].join('|');
}

async function verifyJoinIdentity(userData: {
  id: string;
  username: string;
  avatar: string | null;
  color: string;
  publicIdentity?: PublicIdentity;
  identitySignature?: string;
  identitySignedAt?: number;
}) {
  if (!userData.publicIdentity || !userData.identitySignature || !userData.identitySignedAt) return false;
  if (userData.publicIdentity.algorithm !== 'nacl-box-ed25519-v1') return false;
  if (userData.publicIdentity.keyId !== keyIdForSigningPublicKey(userData.publicIdentity.signingPublicKey)) return false;

  return nacl.sign.detached.verify(
    new TextEncoder().encode(joinSigningText({ ...userData, publicIdentity: userData.publicIdentity, identitySignedAt: userData.identitySignedAt })),
    Buffer.from(userData.identitySignature, 'base64'),
    Buffer.from(userData.publicIdentity.signingPublicKey, 'base64'),
  );
}

function publicUser(user: ConnectedUser) {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    color: user.color,
    publicIdentity: user.publicIdentity,
    identitySignature: user.identitySignature,
    identitySignedAt: user.identitySignedAt,
    identityVerified: user.identityVerified,
  };
}

function broadcastUsers() {
  io.emit('users', Array.from(users.values()).map(publicUser));
}

function getGroupsForUser(userId: string) {
  return Array.from(groups.values())
    .filter(g => g.members.has(userId))
    .map(g => ({ id: g.id, name: g.name, members: Array.from(g.members) }));
}

function sendGroupsToUser(userId: string) {
  const user = users.get(userId);
  if (user) io.to(user.socketId).emit('groups', getGroupsForUser(userId));
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', async (userData: {
    id: string;
    username: string;
    avatar: string | null;
    color: string;
    isAnonymous?: boolean;
    publicIdentity?: PublicIdentity;
    identitySignature?: string;
    identitySignedAt?: number;
  }) => {
    const userId = userData.id;
    const identityVerified = userData.isAnonymous ? false : await verifyJoinIdentity(userData).catch(() => false);
    if (!userData.isAnonymous && !identityVerified) {
      socket.emit('identityError', { code: 'invalid-identity', message: 'Identity signature verification failed.' });
      socket.disconnect(true);
      return;
    }

    const existingKeyId = identityKeyIds.get(userId);
    const nextKeyId = userData.publicIdentity?.keyId;
    if (!userData.isAnonymous && existingKeyId && nextKeyId && existingKeyId !== nextKeyId) {
      socket.emit('identityError', { code: 'identity-changed', message: 'This user id is already bound to a different key.' });
      socket.disconnect(true);
      return;
    }

    const existingUser = users.get(userId);
    if (existingUser && existingUser.socketId !== socket.id) {
      activeSockets.delete(existingUser.socketId);
    }

    activeSockets.set(socket.id, userId);
    if (nextKeyId) identityKeyIds.set(userId, nextKeyId);
    users.set(userId, { ...userData, socketId: socket.id, identityVerified });
    
    broadcastUsers();
    socket.emit('groups', getGroupsForUser(userId));
    
    // Announce user joining global
    socket.broadcast.emit('message', {
      id: Date.now().toString(),
      senderId: 'system',
      receiverId: 'global',
      type: 'system',
      content: `${userData.username} 加入了公开聊天室`,
      timestamp: Date.now(),
    });
  });

  socket.on('createGroup', ({ name, invitees }: { name: string, invitees: string[] }) => {
    const creatorId = activeSockets.get(socket.id);
    if (!creatorId) return;
    
    const groupId = 'group_' + Date.now() + Math.random().toString(36).substring(5);
    groups.set(groupId, { id: groupId, name, members: new Set([creatorId]) });
    
    socket.emit('groups', getGroupsForUser(creatorId));

    invitees.forEach(invId => {
      const u = users.get(invId);
      if (u) io.to(u.socketId).emit('groupInvite', { groupId, name, inviterId: creatorId });
    });
  });

  socket.on('acceptInvite', ({ groupId }: { groupId: string }) => {
    const userId = activeSockets.get(socket.id);
    if (!userId) return;
    
    const group = groups.get(groupId);
    if (group) {
      group.members.add(userId);
      
      group.members.forEach(memberId => {
        const u = users.get(memberId);
        if (u) io.to(u.socketId).emit('groups', getGroupsForUser(memberId));
      });

      const user = users.get(userId);
      if (user) {
        const joinMsg = {
          id: Date.now().toString() + Math.random().toString(36).substring(5),
          senderId: 'system',
          receiverId: groupId,
          type: 'system',
          content: `${user.username} 加入了群组`,
          timestamp: Date.now(),
        };
        group.members.forEach(memberId => {
          const u = users.get(memberId);
          if (u) io.to(u.socketId).emit('message', joinMsg);
        });
      }
    }
  });

  socket.on('leaveGroup', ({ groupId }: { groupId: string }) => {
    const userId = activeSockets.get(socket.id);
    if (!userId) return;

    const group = groups.get(groupId);
    if (!group) return;

    group.members.delete(userId);
    sendGroupsToUser(userId);

    if (group.members.size === 0) {
      groups.delete(groupId);
      return;
    }

    group.members.forEach(memberId => sendGroupsToUser(memberId));
  });

  socket.on('sendMessage', (msg: any) => {
    const senderId = activeSockets.get(socket.id);
    if (!senderId) return;
    const receiverId = String(msg.receiverId || '');
    if (!receiverId) return;
    const isPrivateText = msg.type === 'text' && receiverId !== 'global' && !receiverId.startsWith('group_');
    if (isPrivateText) {
      if (!msg.isEncrypted || !msg.encryption?.ciphertext || !msg.encryption?.iv || !msg.encryption?.messageId) {
        socket.emit('messageError', { code: 'private-text-requires-e2ee', message: 'Private text messages must be end-to-end encrypted.' });
        return;
      }
    }

    const message = {
      ...msg,
      senderId,
      receiverId,
      content: msg.isEncrypted ? '[encrypted]' : msg.content,
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };
    
    if (receiverId === 'global') {
      io.emit('message', message);
    } else if (receiverId.startsWith('group_')) {
      const group = groups.get(receiverId);
      if (group) {
        group.members.forEach(memberId => {
          const u = users.get(memberId);
          if (u) io.to(u.socketId).emit('message', message);
        });
      }
    } else {
      const receiver = users.get(receiverId);
      if (receiver) io.to(receiver.socketId).emit('message', message);
      
      if (senderId !== receiverId) {
        socket.emit('message', message);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const userId = activeSockets.get(socket.id);
    
    if (userId) {
      const user = users.get(userId);
      users.delete(userId);
      activeSockets.delete(socket.id);
      
      broadcastUsers();
      
      if (user) {
        io.emit('message', {
          id: Date.now().toString(),
          senderId: 'system',
          receiverId: 'global',
          type: 'system',
          content: `${user.username} 下线了`,
          timestamp: Date.now(),
        });
      }
    }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = runtimeDir;
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const tryListen = (port: number) => {
    const handleListening = () => {
      httpServer.off('error', handleError);
      currentPort = port;
      console.log('Server running. Open one of these URLs:');
      getAccessUrls(port).forEach((url) => console.log(`  ${url}`));
      try {
        const bonjour = new Bonjour();
        const service = bonjour.publish({ name: mdnsHostname, type: 'http', port, probe: false });
        service.on('error', (err) => console.error('mdns error:', err));
      } catch (e) {
        console.error('mdns error:', e);
      }
    };

    const handleError = (err: NodeJS.ErrnoException) => {
      httpServer.off('listening', handleListening);
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, trying ${port + 1}...`);
        httpServer.close(() => tryListen(port + 1));
      } else {
        console.error(err);
      }
    };

    httpServer.once('listening', handleListening);
    httpServer.once('error', handleError);
    httpServer.listen(port, '0.0.0.0');
  };

  tryListen(PORT);
}

startServer();
