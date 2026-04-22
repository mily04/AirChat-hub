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

// Setup file uploads setup
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
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

function getUploadOriginalName(req: any, file: Express.Multer.File) {
  const queryName = typeof req.query?.originalNameEncoded === 'string' ? req.query.originalNameEncoded : '';
  const bodyEncodedName = typeof req.body?.originalNameEncoded === 'string' ? req.body.originalNameEncoded : '';
  const encodedName = queryName || bodyEncodedName;
  if (encodedName) {
    try {
      return sanitizeFilename(decodeURIComponent(encodedName));
    } catch {
      // Fall back to the browser-provided names below.
    }
  }

  const bodyName = typeof req.body?.originalName === 'string' ? req.body.originalName : '';
  return sanitizeFilename(bodyName || decodeOriginalFilename(file.originalname));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const originalName = getUploadOriginalName(req, file);
    cb(null, uniqueSuffix + '-' + originalName);
  },
});
const upload = multer({ storage });

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

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${encodeURIComponent(req.file.filename)}`;
  res.json({
    url: fileUrl,
    originalName: getUploadOriginalName(req, req.file),
    size: req.file.size,
    mimeType: req.file.mimetype
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Real-time Chat
const users = new Map<string, { id: string; username: string; avatar: string | null; color: string; socketId: string }>();
const activeSockets = new Map<string, string>(); // socketId -> userId
const groups = new Map<string, { id: string; name: string; members: Set<string> }>();

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

  socket.on('join', (userData: { id: string; username: string; avatar: string | null; color: string }) => {
    const userId = userData.id;
    activeSockets.set(socket.id, userId);
    users.set(userId, { ...userData, socketId: socket.id });
    
    io.emit('users', Array.from(users.values()).map(u => ({ id: u.id, username: u.username, avatar: u.avatar, color: u.color })));
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
    const message = {
      ...msg,
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      timestamp: Date.now()
    };
    
    if (msg.receiverId === 'global') {
      io.emit('message', message);
    } else if (msg.receiverId.startsWith('group_')) {
      const group = groups.get(msg.receiverId);
      if (group) {
        group.members.forEach(memberId => {
          const u = users.get(memberId);
          if (u) io.to(u.socketId).emit('message', message);
        });
      }
    } else {
      const receiver = users.get(msg.receiverId);
      if (receiver) io.to(receiver.socketId).emit('message', message);
      
      const senderId = activeSockets.get(socket.id);
      if (senderId && senderId !== msg.receiverId) {
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
      
      io.emit('users', Array.from(users.values()).map(u => ({ id: u.id, username: u.username, avatar: u.avatar, color: u.color })));
      
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
