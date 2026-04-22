/*
 * Copyright (C) 2026 mily04
 * This file is part of AirChat.
 *
 * Licensed under the GNU Affero General Public License, version 3 or later.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Commercial licensing is available from: mily040625@gmail.com
 */

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { sha256 } from 'js-sha256';
import { Send, Paperclip, FileText, Image as ImageIcon, Video, User as UserIcon, LogOut, Sun, Moon, Palette, Plus, Users, Check, X, Copy, Trash2, ChevronLeft, Globe, MoreVertical, Share2, Forward, Download, CheckSquare, Square } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Profile, User, ChatMessage, Attachment, Group, GroupInvite } from './types';
import { airChatRepository, MESSAGE_PAGE_SIZE } from './db';
import { buildJoinIdentityProof, decryptPrivateText, encryptPrivateText, ensureE2EEIdentity, type LocalE2EEIdentity } from './e2ee';

// Utility for Tailwind
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Generates a simple UUID-like string
const generateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// Global socket instance
const socket: Socket = io('/', { autoConnect: false });
const MAX_RENDERED_MESSAGES_PER_ROOM = MESSAGE_PAGE_SIZE * 3;
const DEFAULT_UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 2;
const MAX_CHUNK_RETRIES = 3;

type UploadState = {
  fileName: string;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  speedBytesPerSecond: number;
  status: 'uploading' | 'retrying' | 'finalizing' | 'failed';
};

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function parseAttachment(content: string): Attachment | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function describeForwardedMessage(msg: ChatMessage, senderName?: string) {
  const time = new Date(msg.timestamp).toLocaleString();
  const prefix = `${senderName || '未知用户'} · ${time}`;

  if (msg.type === 'text') return `${prefix}\n${msg.content}`;
  if (msg.type === 'file') {
    const file = parseAttachment(msg.content);
    if (!file) return `${prefix}\n[无效附件]`;
    return `${prefix}\n[文件] ${file.originalName} (${formatBytes(file.size)})\n${file.url}`;
  }
  return `${prefix}\n[系统消息] ${msg.content}`;
}

const PALETTE_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b', // Slate
];

function getLuminance(r: number, g: number, b: number) {
  const a = [r, g, b].map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function hexToRgb(hex: string) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

function isLightColor(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return getLuminance(rgb.r, rgb.g, rgb.b) > 0.45;
}

function ThemeSwitcher({ currentTheme, setTheme, placement = 'bottom' }: { currentTheme: string, setTheme: (t: string) => void, placement?: 'top' | 'bottom' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [glassColor, setGlassColor] = useState(() => localStorage.getItem('lan-glass-color') || '#ec4899');

  useEffect(() => {
    if (currentTheme === 'glass') {
       document.documentElement.style.setProperty('--glass-bg-val', glassColor);
       const isLight = isLightColor(glassColor);
       if (isLight) {
         document.body.setAttribute('data-glass-contrast', 'light');
       } else {
         document.body.removeAttribute('data-glass-contrast');
       }
    } else {
       document.body.removeAttribute('data-glass-contrast');
       document.documentElement.style.removeProperty('--glass-bg-val');
    }
    
    document.body.setAttribute('data-theme', currentTheme);
    localStorage.setItem('lan-chat-theme', currentTheme);
  }, [currentTheme, glassColor]);
  
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setGlassColor(newColor);
    localStorage.setItem('lan-glass-color', newColor);
    setTheme('glass');
  };

  const getIcon = () => {
    if (currentTheme === 'minimal') return <Sun size={18} />;
    if (currentTheme === 'dark') return <Moon size={18} />;
    return <Palette size={18} />;
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-2 rounded-xl transition-colors theme-text-muted hover:theme-text-main hover:bg-[var(--item-hover)] cursor-pointer border border-[var(--panel-border)] shadow-sm bg-[var(--panel-bg)]"
        title="设置主题"
      >
         {getIcon()}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className={cn(
            "absolute right-0 p-2 theme-panel rounded-2xl shadow-xl flex flex-col gap-1 z-50 border border-[var(--panel-border)] min-w-[140px] animate-in fade-in zoom-in-95 origin-top-right",
            placement === 'bottom' ? "top-12 mt-2" : "bottom-full mb-2 origin-bottom-right"
          )}>
            <button 
              onClick={() => { setTheme('dark'); setIsOpen(false); }}
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer", currentTheme === 'dark' ? "bg-[var(--text-main)] text-[var(--page-bg)]" : "theme-text-main hover:bg-[var(--item-hover)]")}
            >
              <Moon size={16} /> 黑色
            </button>
            <button 
              onClick={() => { setTheme('minimal'); setIsOpen(false); }}
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer", currentTheme === 'minimal' ? "bg-[var(--text-main)] text-[var(--page-bg)]" : "theme-text-main hover:bg-[var(--item-hover)]")}
            >
              <Sun size={16} /> 白色
            </button>
            <label 
              className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer relative", currentTheme === 'glass' ? "bg-[var(--text-main)] text-[var(--page-bg)]" : "theme-text-main hover:bg-[var(--item-hover)]")}
            >
              <Palette size={16} /> 调色盘
              <input 
                 type="color" 
                 value={glassColor}
                 onChange={handleColorChange}
                 className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                 title="点击选取自定义毛玻璃背景色"
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

function UserAvatar({ user, className }: { user: { username?: string, avatar?: string | null, color?: string }, className?: string }) {
  if (user.avatar) {
    return <img src={user.avatar} className={cn("rounded-full object-cover", className)} alt={user.username} />;
  }
  return (
    <div
      className={cn("rounded-full flex items-center justify-center text-white font-bold uppercase", className)}
      style={{ backgroundColor: user.color }}
    >
      {user.username ? user.username.charAt(0) : '?'}
    </div>
  );
}

export default function App() {
  const [appView, setAppView] = useState<'START' | 'SETUP' | 'CHAT'>('START');
  const [mobileView, setMobileView] = useState<'SIDEBAR' | 'CHAT'>('SIDEBAR');
  
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [e2eeIdentity, setE2eeIdentity] = useState<LocalE2EEIdentity | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [activeChat, setActiveChat] = useState<string>('global'); 
  
  const [serverUsers, setServerUsers] = useState<User[]>([]);
  const [knownUsers, setKnownUsers] = useState<Record<string, User>>({});
  const [deletedUsers, setDeletedUsers] = useState<Record<string, true>>({});
  
  const [serverGroups, setServerGroups] = useState<Group[]>([]);
  const [knownGroups, setKnownGroups] = useState<Record<string, Group>>({});
  const [deletedGroups, setDeletedGroups] = useState<Record<string, true>>({});
  
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [roomHasMore, setRoomHasMore] = useState<Record<string, boolean>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  
  const [inputValue, setInputValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'friend' | 'group'; id: string; name: string } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Record<string, true>>({});
  const [forwardDraft, setForwardDraft] = useState<{ messages: ChatMessage[]; mode: 'single' | 'separate' | 'merged' } | null>(null);
  const [serverInfo, setServerInfo] = useState<{ localIp: string, port: number, mdnsUrl: string, appUrl?: string } | null>(null);

  const [theme, setTheme] = useState(() => localStorage.getItem('lan-chat-theme') || 'minimal');
  
  const hasShownAnonRef = useRef(false);
  const loadingProfileRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch server info
  useEffect(() => {
    fetch('/api/server-info')
      .then(res => res.json())
      .then(data => setServerInfo(data))
      .catch(err => console.error('Failed to get server info', err));
  }, []);

  const loadRoomMessages = async (profileId: string, roomId: string, mode: 'recent' | 'older' = 'recent') => {
    if (mode === 'older') setLoadingHistory(true);
    try {
      const existing = chats[roomId] || [];
      const page = mode === 'older' && existing.length > 0
        ? await airChatRepository.getMessagesBefore(profileId, roomId, existing[0].timestamp, MESSAGE_PAGE_SIZE)
        : await airChatRepository.getRecentMessages(profileId, roomId, MESSAGE_PAGE_SIZE);

      setChats(prev => {
        const current = mode === 'older' ? (prev[roomId] || []) : [];
        const byId = new Map<string, ChatMessage>();
        [...page.messages, ...current].forEach(msg => byId.set(msg.id, msg));
        return {
          ...prev,
          [roomId]: Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp),
        };
      });
      setRoomHasMore(prev => ({ ...prev, [roomId]: page.hasMore }));
    } catch (error) {
      console.error('Failed to load message history', error);
    } finally {
      if (mode === 'older') setLoadingHistory(false);
    }
  };

  // Load profiles on mount
  useEffect(() => {
    let cancelled = false;
    airChatRepository.getProfiles()
      .then(savedProfiles => {
        if (!cancelled) setProfiles(savedProfiles);
      })
      .catch(error => console.error('Failed to load profiles', error));
    return () => { cancelled = true; };
  }, []);

  // Update logic: When profile changes, load its specific data
  useEffect(() => {
    let cancelled = false;
    hasShownAnonRef.current = false;

    if (profile && !profile.isAnonymous) {
      loadingProfileRef.current = profile.id;
      setKnownUsers({});
      setDeletedUsers({});
      setKnownGroups({});
      setDeletedGroups({});
      setChats({});
      setRoomHasMore({});

      airChatRepository.getContacts(profile.id)
        .then(({ users, deletedUsers, groups, deletedGroups }) => {
          if (cancelled || loadingProfileRef.current !== profile.id) return;
          setKnownUsers(users);
          setDeletedUsers(deletedUsers);
          setKnownGroups(groups);
          setDeletedGroups(deletedGroups);
          void loadRoomMessages(profile.id, activeChat, 'recent');
        })
        .catch(error => console.error('Failed to load local profile data', error));
    } else {
      loadingProfileRef.current = null;
      setKnownUsers({});
      setDeletedUsers({});
      setKnownGroups({});
      setDeletedGroups({});
      setChats({});
      setRoomHasMore({});
    }
    return () => { cancelled = true; };
  }, [profile?.id]);

  useEffect(() => {
    if (profile && !profile.isAnonymous) {
      void loadRoomMessages(profile.id, activeChat, 'recent');
    }
  }, [activeChat, profile?.id]);

  // Theme effect
  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('lan-chat-theme', theme);
  }, [theme]);

  // Handle Anon welcome message
  useEffect(() => {
     if (profile?.isAnonymous && isConnected && !hasShownAnonRef.current) {
         addMessageToChat({
            id: 'anon-sys-msg',
            senderId: 'system',
            receiverId: 'global',
            type: 'system',
            content: '您正在使用匿名登录。退出主界面或浏览器后，您的身份和所有聊天记录将自动被清空并销毁。',
            timestamp: Date.now()
         });
         hasShownAnonRef.current = true;
     }
  }, [profile, isConnected]);

  const decryptIncomingMessage = async (msg: ChatMessage): Promise<ChatMessage> => {
    if (!msg.isEncrypted || !msg.encryption || msg.type !== 'text') return msg;
    if (!profile || !e2eeIdentity) {
      return { ...msg, content: '[Encrypted private message: local key is unavailable]', encryptionStatus: 'missing-key' };
    }

    const peerId = msg.senderId === profile.id ? msg.receiverId : msg.senderId;
    const peer = allUsersMap.get(peerId) || knownUsers[peerId] || serverUsers.find(user => user.id === peerId);
    if (!peer?.publicIdentity) {
      return { ...msg, content: '[Encrypted private message: peer key is unavailable]', encryptionStatus: 'missing-key' };
    }

    try {
      const plaintext = await decryptPrivateText({
        message: msg,
        currentProfileId: profile.id,
        peer,
        identity: e2eeIdentity,
      });
      return { ...msg, content: plaintext, encryptionStatus: 'decrypted' };
    } catch (error) {
      console.error('Failed to decrypt private message', error);
      return { ...msg, content: '[Encrypted private message: decryption failed]', encryptionStatus: 'decrypt-failed' };
    }
  };

  // Setup Socket Listeners
  useEffect(() => {
    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('users', (updatedUsers: User[]) => {
      setServerUsers(updatedUsers);
      if (profile && !profile.isAnonymous) {
        setKnownUsers(prev => {
          const next = { ...prev };
          updatedUsers.forEach(u => {
            if (u.id !== profile.id && !deletedUsers[u.id]) next[u.id] = u;
          });
          void airChatRepository.saveUsers(profile.id, Object.values(next));
          return next;
        });
      }
    });

    socket.on('groups', (updatedGroups: Group[]) => {
      setServerGroups(updatedGroups);
      if (profile && !profile.isAnonymous) {
        setKnownGroups(prev => {
          const next = { ...prev };
          updatedGroups.forEach(g => {
            if (!deletedGroups[g.id]) next[g.id] = g;
          });
          void airChatRepository.saveGroups(profile.id, Object.values(next));
          return next;
        });
      }
    });

    socket.on('groupInvite', (invite: GroupInvite) => {
      if (deletedGroups[invite.groupId]) return;
      setInvites(prev => [...prev, invite]);
    });

    socket.on('message', (msg: ChatMessage) => {
      void decryptIncomingMessage(msg).then(addMessageToChat);
    });

    socket.on('messageError', (error: { message?: string }) => {
      setSecurityNotice(error.message || 'Message was rejected by the server.');
    });

    socket.on('identityError', (error: { message?: string }) => {
      setSecurityNotice(error.message || 'Identity verification failed.');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected');
      setIsConnected(false);
    });

    return () => {
      socket.off('connect');
      socket.off('users');
      socket.off('groups');
      socket.off('groupInvite');
      socket.off('message');
      socket.off('messageError');
      socket.off('identityError');
      socket.off('disconnect');
    };
  }, [profile, deletedUsers, deletedGroups, e2eeIdentity, knownUsers, serverUsers]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [chats, activeChat, mobileView]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedMessageIds({});
    setForwardDraft(null);
  }, [activeChat, profile?.id]);

  const addMessageToChat = (msg: ChatMessage) => {
      const room = airChatRepository.roomForMessage(msg, profile?.id || '');
      if (profile && !profile.isAnonymous) {
        void airChatRepository.addMessage(profile.id, room, msg).catch(error => console.error('Failed to save message', error));
      }
      if ((chats[room] || []).length >= MAX_RENDERED_MESSAGES_PER_ROOM) {
        setRoomHasMore(current => ({ ...current, [room]: true }));
      }
      setChats(prev => {
         const roomChats = prev[room] || [];
         
         // simple deduplication just in case
         if (roomChats.some(m => m.id === msg.id)) return prev;

         const nextRoomChats = [...roomChats, msg];
         if (nextRoomChats.length > MAX_RENDERED_MESSAGES_PER_ROOM) {
           return { ...prev, [room]: nextRoomChats.slice(-MAX_RENDERED_MESSAGES_PER_ROOM) };
         }

         return { ...prev, [room]: nextRoomChats };
      });
  };

  const handleCreateProfile = (username: string, avatar: string | null, color: string) => {
    const newProfile: Profile = { id: generateId(), username, avatar, color };
    const newProfiles = [...profiles, newProfile];
    setProfiles(newProfiles);
    void airChatRepository.saveProfile(newProfile).catch(error => console.error('Failed to save profile', error));
    loginWithProfile(newProfile);
  };

  const loginWithProfile = async (p: Profile) => {
    setProfile(p);
    setAppView('CHAT');
    setMobileView('SIDEBAR');
    setSecurityNotice(null);
    try {
      const identity = p.isAnonymous ? null : await ensureE2EEIdentity(p);
      setE2eeIdentity(identity);
      const proof = identity ? await buildJoinIdentityProof(p, identity) : null;
      socket.connect();
      socket.emit('join', {
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        color: p.color,
        isAnonymous: p.isAnonymous,
        ...(proof || {}),
      });
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to initialize E2EE identity', error);
      setSecurityNotice('Private chat encryption could not be initialized on this browser.');
      socket.connect();
      socket.emit('join', { id: p.id, username: p.username, avatar: p.avatar, color: p.color, isAnonymous: p.isAnonymous });
      setIsConnected(true);
    }
  };

  const deleteProfile = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if(window.confirm('确认删除此账户及其所有本地聊天记录吗？')) {
      const newProfiles = profiles.filter(p => p.id !== id);
      setProfiles(newProfiles);
      void airChatRepository.deleteProfile(id).catch(error => console.error('Failed to delete profile data', error));
    }
  };

  const handleLogout = () => {
    socket.disconnect();
    setIsConnected(false);
    setProfile(null);
    setE2eeIdentity(null);
    setServerUsers([]);
    setServerGroups([]);
    setInvites([]);
    setActiveChat('global');
    setAppView('START');
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || !isConnected || !profile) return;

    const content = inputValue;
    const isPrivateChat = activeChat !== 'global' && !activeChat.startsWith('group_');
    if (isPrivateChat) {
      const receiver = allUsersMap.get(activeChat) || knownUsers[activeChat] || serverUsers.find(user => user.id === activeChat);
      if (!e2eeIdentity || !receiver?.publicIdentity) {
        setSecurityNotice('Private text cannot be sent until both users have published encryption keys.');
        return;
      }

      try {
        const encryption = await encryptPrivateText({
          plaintext: content,
          sender: profile,
          receiver,
          identity: e2eeIdentity,
        });
        socket.emit('sendMessage', {
          senderId: profile.id,
          receiverId: activeChat,
          type: 'text',
          content: '[encrypted]',
          isEncrypted: true,
          encryption,
        });
        setInputValue('');
      } catch (error) {
        console.error('Failed to encrypt private message', error);
        setSecurityNotice('Private text encryption failed. Message was not sent.');
      }
      return;
    }

    socket.emit('sendMessage', {
      senderId: profile.id,
      receiverId: activeChat,
      type: 'text',
      content,
    });
    setInputValue('');
  };

  const fetchUploadConfig = async () => {
    try {
      const response = await fetch('/api/upload/config');
      if (!response.ok) throw new Error(`Upload config failed: ${response.status}`);
      return await response.json() as { chunkSize: number; maxChunkSize: number; maxFileSize: number };
    } catch {
      return { chunkSize: DEFAULT_UPLOAD_CHUNK_SIZE, maxChunkSize: DEFAULT_UPLOAD_CHUNK_SIZE, maxFileSize: Number.MAX_SAFE_INTEGER };
    }
  };

  const sha256Hex = async (blob: Blob) => {
    const buffer = await blob.arrayBuffer();
    return sha256(buffer);
  };

  const sha256Text = async (text: string) => {
    return sha256(text);
  };

  const getUploadIdForFile = async (file: File) => {
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${file.type || 'application/octet-stream'}`;
    return sha256Text(fingerprint);
  };

  const uploadChunkWithRetry = async (params: {
    file: File;
    uploadId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    uploadedChunks: Set<number>;
    onChunkComplete: (chunkIndex: number, bytes: number) => void;
  }) => {
    const { file, uploadId, chunkIndex, totalChunks, chunkSize, uploadedChunks, onChunkComplete } = params;
    if (uploadedChunks.has(chunkIndex)) return;

    const start = chunkIndex * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunk = file.slice(start, end);
    const chunkHash = await sha256Hex(chunk);

    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
      if (attempt > 1) {
        setUploadState(current => current ? { ...current, status: 'retrying' } : current);
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }

      const formData = new FormData();
      formData.append('uploadId', uploadId);
      formData.append('fileId', uploadId);
      formData.append('chunkIndex', String(chunkIndex));
      formData.append('totalChunks', String(totalChunks));
      formData.append('totalSize', String(file.size));
      formData.append('chunkSize', String(chunkSize));
      formData.append('originalNameEncoded', encodeURIComponent(file.name));
      formData.append('mimeType', file.type || 'application/octet-stream');
      formData.append('chunkHash', chunkHash);
      formData.append('encrypted', 'false');
      formData.append('chunk', chunk, `${chunkIndex}.part`);

      const response = await fetch('/api/upload/chunk', { method: 'POST', body: formData });
      if (response.ok) {
        onChunkComplete(chunkIndex, chunk.size);
        return;
      }

      if (attempt === MAX_CHUNK_RETRIES) {
        const message = await response.text().catch(() => '');
        throw new Error(`Chunk ${chunkIndex} failed: ${response.status} ${message}`);
      }
    }
  };

  const uploadFile = async (file: File) => {
    if (!isConnected || !profile) return;
    const config = await fetchUploadConfig();
    if (file.size > config.maxFileSize) {
      throw new Error(`File exceeds maximum upload size: ${formatBytes(config.maxFileSize)}`);
    }

    const chunkSize = Math.min(config.chunkSize || DEFAULT_UPLOAD_CHUNK_SIZE, config.maxChunkSize || DEFAULT_UPLOAD_CHUNK_SIZE);
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const uploadId = await getUploadIdForFile(file);
    const statusResponse = await fetch(`/api/upload/status?uploadId=${encodeURIComponent(uploadId)}&totalChunks=${totalChunks}`);
    const statusData = statusResponse.ok ? await statusResponse.json() : { uploadedChunks: [] };
    const uploadedChunks = new Set<number>((statusData.uploadedChunks || []).map(Number));

    let uploadedBytes = Array.from(uploadedChunks).reduce((total, index) => {
      const start = index * chunkSize;
      return total + Math.max(0, Math.min(chunkSize, file.size - start));
    }, 0);
    const startTime = performance.now();
    setUploadState({
      fileName: file.name,
      progress: file.size ? uploadedBytes / file.size : 1,
      uploadedBytes,
      totalBytes: file.size,
      speedBytesPerSecond: 0,
      status: 'uploading',
    });

    const onChunkComplete = (chunkIndex: number, bytes: number) => {
      if (uploadedChunks.has(chunkIndex)) return;
      uploadedChunks.add(chunkIndex);
      uploadedBytes += bytes;
      const elapsedSeconds = Math.max((performance.now() - startTime) / 1000, 0.1);
      setUploadState({
        fileName: file.name,
        progress: file.size ? uploadedBytes / file.size : 1,
        uploadedBytes,
        totalBytes: file.size,
        speedBytesPerSecond: uploadedBytes / elapsedSeconds,
        status: 'uploading',
      });
    };

    let cursor = 0;
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, totalChunks) }, async () => {
      while (cursor < totalChunks) {
        const chunkIndex = cursor;
        cursor += 1;
        await uploadChunkWithRetry({ file, uploadId, chunkIndex, totalChunks, chunkSize, uploadedChunks, onChunkComplete });
      }
    });
    await Promise.all(workers);

    setUploadState(current => current ? { ...current, status: 'finalizing', progress: 1 } : current);
    const completeResponse = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        fileId: uploadId,
        totalChunks,
        totalSize: file.size,
        chunkSize,
        originalName: file.name,
        originalNameEncoded: encodeURIComponent(file.name),
        mimeType: file.type || 'application/octet-stream',
        encrypted: false,
      }),
    });
    if (!completeResponse.ok) throw new Error(`Upload finalize failed: ${completeResponse.status} ${await completeResponse.text().catch(() => '')}`);

    const data = await completeResponse.json();
    const attachment: Attachment = {
      url: data.url,
      originalName: data.originalName,
      size: data.size,
      mimeType: data.mimeType,
      uploadId,
      fileId: data.fileId || uploadId,
      chunkSize,
      totalChunks,
      encrypted: false,
      integrity: {
        algorithm: 'sha-256',
        fileHash: data.fileHash || undefined,
      },
    };

    socket.emit('sendMessage', {
      senderId: profile.id,
      receiverId: activeChat,
      type: 'file',
      content: JSON.stringify(attachment),
    });
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0 || !isConnected || !profile) return;

    setUploading(true);
    try {
      for (const file of files) {
        await uploadFile(file);
      }
    } catch (error) {
      console.error('File upload failed', error);
      setUploadState(current => current ? { ...current, status: 'failed' } : current);
      alert('文件上传失败');
    } finally {
      setUploading(false);
      setTimeout(() => setUploadState(null), 1500);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []) as File[];
    await uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleChatDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingFile(true);
    }
  };

  const handleChatDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDraggingFile(false);
    }
  };

  const handleChatDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setIsDraggingFile(false);
    await uploadFiles(Array.from(e.dataTransfer.files) as File[]);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const deleteMessage = (msgId: string) => {
    if (profile && !profile.isAnonymous) {
      void airChatRepository.deleteMessage(profile.id, activeChat, msgId).catch(error => console.error('Failed to delete message', error));
    }
    setChats(prev => {
      const currentRoomChats = prev[activeChat] || [];
      return {
        ...prev,
        [activeChat]: currentRoomChats.filter(m => m.id !== msgId)
      };
    });
  };

  const clearHistory = () => {
    if (window.confirm('确认清空当前对话的所有本地历史记录吗？不可恢复。')) {
      if (profile && !profile.isAnonymous) {
        void airChatRepository.deleteRoom(profile.id, activeChat).catch(error => console.error('Failed to clear room history', error));
      }
      setChats(prev => ({ ...prev, [activeChat]: [] }));
      setRoomHasMore(prev => ({ ...prev, [activeChat]: false }));
    }
  };

  const askDeleteFriend = (e: React.MouseEvent, user: User) => {
    e.stopPropagation();
    setDeleteTarget({ type: 'friend', id: user.id, name: user.username });
  };

  const askDeleteGroup = (e: React.MouseEvent, group: Group) => {
    e.stopPropagation();
    setDeleteTarget({ type: 'group', id: group.id, name: group.name });
  };

  const deleteFriend = (userId: string) => {
    if (profile && !profile.isAnonymous) {
      void airChatRepository.markUserDeleted(profile.id, userId).catch(error => console.error('Failed to delete friend', error));
      void airChatRepository.deleteRoom(profile.id, userId).catch(error => console.error('Failed to delete friend history', error));
    }
    setDeletedUsers(prev => ({ ...prev, [userId]: true }));
    setKnownUsers(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setServerUsers(prev => prev.filter(u => u.id !== userId));
    setChats(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    if (activeChat === userId) setActiveChat('global');
  };

  const deleteGroup = (groupId: string) => {
    socket.emit('leaveGroup', { groupId });
    if (profile && !profile.isAnonymous) {
      void airChatRepository.markGroupDeleted(profile.id, groupId).catch(error => console.error('Failed to delete group', error));
      void airChatRepository.deleteRoom(profile.id, groupId).catch(error => console.error('Failed to delete group history', error));
    }
    setDeletedGroups(prev => ({ ...prev, [groupId]: true }));
    setKnownGroups(prev => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    setServerGroups(prev => prev.filter(g => g.id !== groupId));
    setInvites(prev => prev.filter(invite => invite.groupId !== groupId));
    setChats(prev => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    if (activeChat === groupId) setActiveChat('global');
  };

  const confirmDeleteTarget = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'friend') deleteFriend(deleteTarget.id);
    else deleteGroup(deleteTarget.id);
    setDeleteTarget(null);
  };

  // Compose displayed users (combine history + online status)
  const allUsersMap = new Map<string, User>();
  Object.values(knownUsers).forEach((u: any) => {
    if (!deletedUsers[u.id]) allUsersMap.set(u.id, { ...u, isOnline: false });
  });
  serverUsers.forEach(u => {
    if (u.id !== profile?.id && !deletedUsers[u.id]) {
      allUsersMap.set(u.id, { ...u, isOnline: true });
    }
  });
  const displayUsers = Array.from(allUsersMap.values()).sort((a, b) => Number(b.isOnline) - Number(a.isOnline));

  // Compose displayed groups
  const allGroupsMap = new Map<string, Group>();
  Object.values(knownGroups).forEach((g: any) => {
    if (!deletedGroups[g.id]) allGroupsMap.set(g.id, g);
  });
  serverGroups.forEach(g => {
    if (!deletedGroups[g.id]) allGroupsMap.set(g.id, g);
  });
  const displayGroups = Array.from(allGroupsMap.values());

  const activeMessages = chats[activeChat] || [];
  const selectedMessages = activeMessages.filter(msg => msg.type !== 'system' && selectedMessageIds[msg.id]);
  const forwardTargets = [
    { id: 'global', name: '公开聊天室', detail: `${serverUsers.length} 人在线` },
    ...displayGroups.map(group => ({ id: group.id, name: group.name, detail: `${group.members.length} 名成员` })),
    ...displayUsers.map(user => ({ id: user.id, name: user.username, detail: user.isOnline ? '在线' : '离线' })),
  ];

  const getSenderName = (msg: ChatMessage) => {
    if (msg.senderId === profile?.id) return profile.username;
    return allUsersMap.get(msg.senderId)?.username || '未知用户';
  };

  const toggleMessageSelection = (msgId: string) => {
    setSelectedMessageIds(prev => {
      const next = { ...prev };
      if (next[msgId]) delete next[msgId];
      else next[msgId] = true;
      return next;
    });
  };

  const startSelectionMode = () => {
    setSelectionMode(true);
    setSelectedMessageIds({});
  };

  const cancelSelectionMode = () => {
    setSelectionMode(false);
    setSelectedMessageIds({});
  };

  const openSingleForward = (msg: ChatMessage) => {
    if (msg.type === 'system') return;
    setForwardDraft({ messages: [msg], mode: 'single' });
  };

  const openSelectedForward = (mode: 'separate' | 'merged') => {
    if (selectedMessages.length === 0) return;
    setForwardDraft({ messages: selectedMessages, mode });
  };

  const sendTextToRoom = async (targetId: string, content: string) => {
    if (!profile) return false;
    const isPrivateTarget = targetId !== 'global' && !targetId.startsWith('group_');
    if (!isPrivateTarget) {
      socket.emit('sendMessage', {
        senderId: profile.id,
        receiverId: targetId,
        type: 'text',
        content,
      });
      return true;
    }

    const receiver = allUsersMap.get(targetId) || knownUsers[targetId] || serverUsers.find(user => user.id === targetId);
    if (!e2eeIdentity || !receiver?.publicIdentity) {
      setSecurityNotice('Forwarding to this private chat requires the recipient encryption key.');
      return false;
    }

    const encryption = await encryptPrivateText({
      plaintext: content,
      sender: profile,
      receiver,
      identity: e2eeIdentity,
    });
    socket.emit('sendMessage', {
      senderId: profile.id,
      receiverId: targetId,
      type: 'text',
      content: '[encrypted]',
      isEncrypted: true,
      encryption,
    });
    return true;
  };

  const sendForward = async (targetId: string) => {
    if (!forwardDraft || !profile) return;

    if (forwardDraft.mode === 'merged') {
      const content = [
        `合并转发 ${forwardDraft.messages.length} 条消息`,
        '',
        ...forwardDraft.messages.map(msg => describeForwardedMessage(msg, getSenderName(msg))),
      ].join('\n\n---\n\n');

      const ok = await sendTextToRoom(targetId, content);
      if (!ok) return;
    } else {
      for (const msg of forwardDraft.messages) {
        if (msg.type !== 'text' && msg.type !== 'file') return;
        if (msg.type === 'text') {
          const ok = await sendTextToRoom(targetId, msg.content);
          if (!ok) return;
        } else {
          socket.emit('sendMessage', {
            senderId: profile.id,
            receiverId: targetId,
            type: msg.type,
            content: msg.content,
          });
        }
      }
    }

    setForwardDraft(null);
    cancelSelectionMode();
  };

  if (appView === 'START') {
    return (
      <StartScreen 
        profiles={profiles} 
        onSelect={loginWithProfile} 
        onNew={() => setAppView('SETUP')} 
        onAnonymous={() => loginWithProfile({ id: generateId(), username: '匿名用户', avatar: null, color: '#64748b', isAnonymous: true })}
        onDelete={deleteProfile}
        currentTheme={theme}
        setTheme={setTheme}
      />
    );
  }

  if (appView === 'SETUP') {
    return <SetupScreen onLogin={handleCreateProfile} onBack={() => setAppView('START')} currentTheme={theme} setTheme={setTheme} />;
  }

  if (!profile) return null;

  // Header Details
  let chatName = '离线 / 未知';
  let membersText = '';
  let securityText = '公开聊天室未加密';
  if (activeChat === 'global') {
     chatName = '公开聊天室';
     membersText = `${serverUsers.length} 人在线`; // includes self, or maybe displayUsers.length online
  } else if (activeChat.startsWith('group_')) {
     const g = allGroupsMap.get(activeChat);
     chatName = g ? g.name : '历史群组';
     membersText = g ? `${g.members.length} 位成员` : '';
  } else {
     const u = allUsersMap.get(activeChat);
     chatName = u ? u.username : '历史联系人';
     membersText = u?.isOnline ? '在线' : '离线';
  }

  if (activeChat.startsWith('group_')) {
    securityText = '群聊未加密';
  } else if (activeChat !== 'global') {
    const activePeerForSecurity = allUsersMap.get(activeChat);
    securityText = e2eeIdentity && activePeerForSecurity?.publicIdentity ? '私聊已加密' : '私聊未加密：缺少密钥';
  }

  return (
    <div className="flex flex-col items-center justify-center h-[100dvh] w-full md:p-6 bg-[var(--page-bg)] overflow-hidden antialiased transition-colors duration-300">
      <div className="flex w-full h-full md:h-[700px] max-w-[1024px] mx-auto theme-panel relative z-10 overflow-hidden md:rounded-[var(--radius-panel)] rounded-none">
        
        {/* Sidebar */}
        <div className={cn(
          "w-full md:w-80 h-full flex flex-col theme-sidebar relative z-10 shrink-0",
          mobileView === 'CHAT' ? "hidden md:flex" : "flex"
        )}>
          <div className="p-4 md:p-6 pb-2 flex items-center justify-between shrink-0">
            <h2 className="text-2xl font-bold tracking-tight theme-text-main">LAN Connect</h2>
            <div className="w-3 h-3 bg-green-500 rounded-full shadow-[0_0_10px_#22c55e]" title="在线"></div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar pb-20">
            {/* My Profile */}
            <div className="flex items-center gap-3 p-3 mb-4 theme-item rounded-2xl mx-2 border border-[var(--panel-border)] shadow-sm">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-inner overflow-hidden shrink-0">
                   <UserAvatar user={profile} className="w-full h-full text-xl" />
                </div>
                <div className="flex-1 overflow-hidden">
                    <p className="theme-text-main font-semibold truncate leading-tight">{profile.username} {profile.isAnonymous && <span className="text-xs bg-black/10 px-1 rounded">匿名</span>}</p>
                    <p className="text-[var(--text-subtle)] text-xs mt-0.5 truncate">在线</p>
                </div>
            </div>

            {/* Public */}
            <div className="px-4 py-2 text-[11px] font-bold theme-text-subtle uppercase tracking-wider">公共区域</div>
            <button
              onClick={() => { setActiveChat('global'); setMobileView('CHAT'); }}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer outline-none theme-item mb-2",
                activeChat === 'global' && "theme-item-active"
              )}
            >
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm font-bold">
                <Globe size={20} />
              </div>
              <div className="flex-1 text-left overflow-hidden">
                <div className="font-medium text-[15px] theme-text-main">公开聊天室</div>
                <div className="text-xs theme-text-subtle">局域网广播</div>
              </div>
            </button>

            {/* Groups */}
            <div className="px-4 py-2 mt-2 flex items-center justify-between group">
              <span className="text-[11px] font-bold theme-text-subtle uppercase tracking-wider">群组 ({displayGroups.length})</span>
              <button 
                onClick={() => setShowCreateGroup(true)}
                className="theme-text-muted hover:theme-text-main p-1 rounded hover:bg-[var(--item-hover)] active:scale-90 transition-all cursor-pointer"
                title="新建群组"
              >
                <Plus size={16} />
              </button>
            </div>
            {displayGroups.map(group => (
              <div
                key={group.id}
                onClick={() => { setActiveChat(group.id); setMobileView('CHAT'); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer outline-none theme-item",
                  activeChat === group.id && "theme-item-active"
                )}
              >
                <div className="w-10 h-10 theme-global-avatar rounded-full border border-[var(--input-border)] flex items-center justify-center text-[var(--text-main)] shrink-0 shadow-sm font-bold">
                  <Users size={18} />
                </div>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="font-medium text-[15px] truncate theme-text-main">{group.name}</div>
                  <div className="text-xs theme-text-subtle truncate">{group.members.length} 名成员</div>
                </div>
                <button
                  onClick={(e) => askDeleteGroup(e, group)}
                  className="w-8 h-8 mr-2 rounded-full flex items-center justify-center text-sm font-semibold theme-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                  title="删除群聊"
                >
                  x
                </button>
              </div>
            ))}

            {/* Direct Messages */}
            <div className="px-4 py-2 mt-4 flex items-center justify-between text-[11px] font-bold theme-text-subtle uppercase tracking-wider">
              <span>好友 ({displayUsers.length})</span>
            </div>
            {displayUsers.map(user => (
              <div
                key={user.id}
                onClick={() => { setActiveChat(user.id); setMobileView('CHAT'); }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer outline-none theme-item",
                  activeChat === user.id && "theme-item-active"
                )}
              >
                <div className="relative shrink-0">
                  <UserAvatar user={user} className={cn("w-10 h-10 shadow-sm border", user.isOnline ? "border-green-500" : "border-[var(--input-border)] opacity-60")} />
                  {user.isOnline && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[var(--panel-bg)] rounded-full"></div>}
                </div>
                <div className="flex-1 text-left overflow-hidden">
                  <div className="font-medium text-[15px] truncate theme-text-main">{user.username}</div>
                  <div className="text-xs theme-text-subtle truncate">{user.isOnline ? '在线' : '离线'}</div>
                </div>
                <button
                  onClick={(e) => askDeleteFriend(e, user)}
                  className="w-8 h-8 mr-2 rounded-full flex items-center justify-center text-sm font-semibold theme-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
                  title="删除好友"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <div className="p-4 theme-border-t shrink-0 flex items-center justify-between gap-4 absolute bottom-0 left-0 right-0 theme-panel rounded-none md:rounded-bl-[var(--radius-panel)] border-x-0 border-b-0">
             <div className="flex items-center gap-2">
               <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 p-2 rounded-xl transition-colors theme-text-muted hover:theme-text-main hover:bg-[var(--item-hover)] text-sm font-medium cursor-pointer"
                  title="退出账户"
               >
                  <LogOut size={18} />
               </button>
               {serverInfo && (
                 <button 
                    onClick={() => setShowShare(true)}
                    className="flex items-center gap-2 p-2 rounded-xl transition-colors theme-text-muted hover:theme-text-main hover:bg-[var(--item-hover)] text-sm font-medium cursor-pointer"
                    title="分享服务器链接"
                 >
                    <Share2 size={18} />
                 </button>
               )}
             </div>
             <ThemeSwitcher currentTheme={theme} setTheme={setTheme} placement="top" />
          </div>
        </div>

        {/* Main Chat Area */}
        <div className={cn(
          "flex-1 h-full flex flex-col theme-chat-bg relative z-10 w-full min-w-0 border-l border-[var(--sidebar-border)]",
          mobileView === 'SIDEBAR' ? "hidden md:flex" : "flex"
        )}
          onDragOver={handleChatDragOver}
          onDragLeave={handleChatDragLeave}
          onDrop={handleChatDrop}
        >
          {isDraggingFile && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 backdrop-blur-sm pointer-events-none">
              <div className="theme-panel px-6 py-5 rounded-2xl flex flex-col items-center gap-3 shadow-2xl">
                <Paperclip size={28} className="theme-text-main" />
                <div className="text-center">
                  <p className="theme-text-main font-semibold">松开以上传文件</p>
                  <p className="theme-text-subtle text-sm mt-1">支持一次拖入多个文件</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Invites Banner */}
          {invites.length > 0 && (
            <div className="absolute top-16 left-0 right-0 z-20 flex flex-col items-center gap-2 pointer-events-none px-4">
              {invites.map(invite => (
                <div key={invite.groupId} className="pointer-events-auto bg-[var(--header-bg)] border border-[var(--panel-border)] backdrop-blur-xl shadow-lg rounded-2xl p-4 flex items-center justify-between w-full max-w-sm gap-4 animate-in fade-in slide-in-from-top-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm theme-text-main font-medium">群组邀请</p>
                    <p className="text-xs theme-text-muted truncate">邀请您加入 <b>{invite.name}</b></p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => setInvites(prev => prev.filter(i => i.groupId !== invite.groupId))} className="w-8 h-8 rounded-full bg-[var(--item-hover)] flex items-center justify-center theme-text-main hover:bg-red-500/20 hover:text-red-500 transition-colors cursor-pointer">
                      <X size={16} />
                    </button>
                    <button onClick={() => { socket.emit('acceptInvite', { groupId: invite.groupId }); setInvites(prev => prev.filter(i => i.groupId !== invite.groupId)); }} className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white hover:bg-blue-600 transition-colors shadow-md cursor-pointer">
                      <Check size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Header */}
          <div className="px-2 md:px-6 py-3 theme-header flex items-center justify-between z-10 sticky top-0 shrink-0 h-16">
            <div className="flex items-center gap-2">
              <button className="md:hidden p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-main cursor-pointer" onClick={() => setMobileView('SIDEBAR')}>
                 <ChevronLeft size={24} />
              </button>
              <div className="overflow-hidden">
                <h2 className="text-lg font-bold theme-text-main truncate">{chatName}</h2>
                <p className="text-xs theme-text-muted font-medium">{membersText} · {securityText}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
               {selectionMode ? (
                 <button onClick={cancelSelectionMode} className="p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-muted hover:theme-text-main transition-colors cursor-pointer" title="退出多选">
                   <X size={18} />
                 </button>
               ) : (
                 <button onClick={startSelectionMode} className="p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-muted hover:theme-text-main transition-colors cursor-pointer" title="多选消息">
                   <CheckSquare size={18} />
                 </button>
               )}
               <button onClick={clearHistory} className="p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-muted hover:text-red-500 transition-colors cursor-pointer" title="清空历史记录">
                 <Trash2 size={18} />
               </button>
            </div>
          </div>

          {securityNotice && (
            <div className="px-4 md:px-6 py-2 bg-amber-500/10 border-t border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium flex items-center justify-between gap-3">
              <span>{securityNotice}</span>
              <button onClick={() => setSecurityNotice(null)} className="p-1 rounded-md hover:bg-amber-500/10 cursor-pointer" title="关闭">
                <X size={14} />
              </button>
            </div>
          )}

          {selectionMode && (
            <div className="px-4 md:px-6 py-2 theme-header flex items-center justify-between gap-3 shrink-0 border-t border-[var(--sidebar-border)]">
              <span className="text-xs font-medium theme-text-muted">已选择 {selectedMessages.length} 条</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openSelectedForward('separate')}
                  disabled={selectedMessages.length === 0}
                  className="px-3 py-2 rounded-xl text-xs font-semibold theme-item theme-text-main border border-[var(--input-border)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  逐条转发
                </button>
                <button
                  onClick={() => openSelectedForward('merged')}
                  disabled={selectedMessages.length === 0}
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm"
                >
                  合并转发
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-6 flex flex-col">
            {activeMessages.length > 0 && roomHasMore[activeChat] && profile && !profile.isAnonymous && (
              <button
                onClick={() => loadRoomMessages(profile.id, activeChat, 'older')}
                disabled={loadingHistory}
                className="self-center px-4 py-2 rounded-xl text-xs font-semibold theme-item theme-text-main border border-[var(--input-border)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loadingHistory ? 'Loading...' : 'Load earlier messages'}
              </button>
            )}

            {activeMessages.length === 0 && (
               <div className="flex flex-col items-center justify-center h-full text-center opacity-50 select-none">
                 <div className="w-20 h-20 mb-4 rounded-full bg-[var(--item-hover)] flex items-center justify-center text-[var(--text-muted)]"><Users size={32} /></div>
                 <p className="theme-text-main font-semibold">暂无聊天记录</p>
                 <p className="theme-text-subtle text-sm mt-1">留存在本地设备的消息将显示在这里</p>
               </div>
            )}
            
            {activeMessages.map((msg) => {
              const isMine = msg.senderId === profile.id;
              const sender = allUsersMap.get(msg.senderId) || (isMine ? profile : null);
              const isSelected = !!selectedMessageIds[msg.id];

              if (msg.type === 'system') {
                return (
                  <div key={msg.id} className="flex justify-center my-2 transition-all">
                     <span className="text-[11px] font-medium theme-sys-msg px-4 py-1.5 rounded-full shadow-sm text-center max-w-[80%]">
                       {msg.content}
                     </span>
                  </div>
                );
              }

              return (
                <div key={msg.id} className={cn("flex w-full gap-3 transition-all items-end group rounded-2xl", isMine ? "justify-end" : "justify-start", isSelected && "bg-[var(--item-hover)]")}>
                  {selectionMode && (
                    <button
                      onClick={() => toggleMessageSelection(msg.id)}
                      className="mb-3 w-8 h-8 rounded-full flex items-center justify-center theme-text-muted hover:theme-text-main hover:bg-[var(--item-hover)] cursor-pointer shrink-0"
                      title={isSelected ? "取消选择" : "选择消息"}
                    >
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                  )}
                  {!isMine && (
                    <div className="shrink-0 hidden md:block mb-1">
                      {sender ? (
                         <UserAvatar user={sender} className="w-8 h-8 border border-[var(--input-border)] shadow-sm text-xs" />
                      ) : (
                         <div className="w-8 h-8 rounded-full theme-avatar border tracking-widest text-[10px] flex items-center justify-center theme-text-muted font-bold uppercase">U</div>
                      )}
                    </div>
                  )}
                  
                  <div className={cn("flex flex-col max-w-[92%] relative", msg.type === 'file' ? "md:max-w-[88%]" : "md:max-w-[70%]", isMine ? "items-end" : "items-start")}>
                    
                    {/* Floating Action Menu */}
                    <div className={cn(
                      "hidden group-hover:flex items-center gap-1 absolute top-1/2 -translate-y-1/2 p-1 rounded-xl bg-[var(--header-bg)] border border-[var(--panel-border)] shadow-md backdrop-blur-md z-10",
                      isMine ? "right-full mr-3" : "left-full ml-3"
                    )}>
                       {msg.type === 'text' && (
                         <button onClick={() => copyText(msg.content)} className="p-1.5 hover:bg-blue-500/10 hover:text-blue-500 rounded-lg theme-text-subtle transition-colors cursor-pointer" title="复制文本"><Copy size={16}/></button>
                       )}
                       <button onClick={() => openSingleForward(msg)} className="p-1.5 hover:bg-blue-500/10 hover:text-blue-500 rounded-lg theme-text-subtle transition-colors cursor-pointer" title="转发"><Forward size={16}/></button>
                       <button onClick={() => deleteMessage(msg.id)} className="p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded-lg theme-text-subtle transition-colors cursor-pointer" title="删除消息"><Trash2 size={16}/></button>
                    </div>

                    {!isMine && (activeChat === 'global' || activeChat.startsWith('group_')) && (
                      <p className="theme-text-subtle text-[10px] mb-1.5 ml-1">{sender?.username || '未知'} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    )}
                    {isMine && (
                      <p className="theme-text-subtle text-[10px] mb-1.5 mr-1 text-right">我 • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    )}
                    
                    <div 
                      className={cn(
                        "text-[15px] p-3 md:p-4 leading-relaxed",
                        isMine ? "theme-bubble-sent shadow-md" : "theme-bubble-recv"
                      )}
                      style={isMine ? { backgroundColor: profile.color, color: '#fff' } : {}}
                    >
                      {msg.type === 'text' && (
                        <p className="whitespace-pre-wrap select-text break-words">{msg.content}</p>
                      )}
                      
                      {msg.type === 'file' && (
                        <FileAttachment preview={msg.content} isMine={isMine} color={isMine ? profile.color : undefined} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-1 shrink-0" />
          </div>

          {/* Input Area */}
          <footer className="p-3 md:p-6 shrink-0 bg-transparent mb-safe">
            {uploadState && (
              <div className="mb-3 theme-panel border border-[var(--panel-border)] rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3 text-xs mb-2">
                  <span className="theme-text-main font-semibold truncate">{uploadState.fileName}</span>
                  <span className="theme-text-muted shrink-0">
                    {Math.round(uploadState.progress * 100)}% · {formatBytes(uploadState.speedBytesPerSecond)}/s · {uploadState.status}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--item-hover)] overflow-hidden">
                  <div
                    className={cn("h-full transition-all", uploadState.status === 'failed' ? "bg-red-500" : "bg-blue-500")}
                    style={{ width: `${Math.min(100, Math.max(0, uploadState.progress * 100))}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] theme-text-subtle">
                  {formatBytes(uploadState.uploadedBytes)} / {formatBytes(uploadState.totalBytes)}
                </div>
              </div>
            )}
            <form 
              onSubmit={sendMessage}
              className="theme-input-wrap rounded-2xl p-2 flex items-center gap-2 shadow-lg"
            >
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-10 h-10 flex items-center justify-center theme-text-muted hover:theme-text-main transition-colors hover:bg-[var(--item-hover)] rounded-xl disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {uploading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div> : <Paperclip size={20} />}
              </button>
              
              <input
                type="text"
                placeholder={uploading ? "正在上传..." : "发送消息或在此拖放文件..."}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={uploading}
                className="flex-1 bg-transparent border-none outline-none theme-text-main placeholder-[var(--text-subtle)] px-2 text-[15px] min-w-0"
              />
              
              <button
                type="submit"
                disabled={!inputValue.trim() || uploading}
                style={inputValue.trim() && !uploading ? { backgroundColor: profile.color } : {}}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-xl transition-all shadow-sm shrink-0",
                  inputValue.trim() && !uploading
                   ? "theme-send-btn cursor-pointer text-white" 
                   : "bg-[var(--item-hover)] text-[var(--text-subtle)] cursor-not-allowed"
                )}
              >
                <Send size={18} className={cn("ml-0.5", (!inputValue.trim() || uploading) && "theme-send-icon-disabled")} />
              </button>
            </form>
          </footer>
        </div>

        {/* Create Group Modal */}
        {showCreateGroup && (
          <CreateGroupModal 
             users={serverUsers.filter(u => u.id !== profile.id)} 
             onClose={() => setShowCreateGroup(false)} 
             onCreate={(name, invitees) => {
               socket.emit('createGroup', { name, invitees });
               setShowCreateGroup(false);
             }} 
          />
        )}
        
        {/* Share Modal */}
        {showShare && serverInfo && (
          <ShareModal serverInfo={serverInfo} onClose={() => setShowShare(false)} />
        )}

        {deleteTarget && (
          <ConfirmDeleteModal
            target={deleteTarget}
            onConfirm={confirmDeleteTarget}
            onCancel={() => setDeleteTarget(null)}
          />
        )}

        {forwardDraft && (
          <ForwardModal
            draft={forwardDraft}
            targets={forwardTargets}
            onForward={sendForward}
            onClose={() => setForwardDraft(null)}
          />
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Subcomponents
// -------------------------------------------------------------

function StartScreen({ profiles, onSelect, onNew, onAnonymous, onDelete, currentTheme, setTheme }: any) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] p-4 bg-[var(--page-bg)] transition-colors antialiased relative">
       <div className="absolute top-6 right-6 z-20">
         <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} placement="bottom" />
       </div>
       
       <div className="text-center mb-12">
          <div className="w-16 h-16 theme-avatar rounded-[1.2rem] mx-auto mb-6 flex items-center justify-center shadow-lg border-none">
            <Send size={28} className="theme-text-main ml-1" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 theme-text-main">LAN Connect</h1>
          <p className="theme-text-subtle text-[15px]">选择您的账户以继续</p>
       </div>

       <div className="flex justify-center flex-wrap max-w-3xl gap-6 px-4">
          {profiles.map((p: Profile) => (
             <div key={p.id} className="relative group flex flex-col items-center gap-3 w-24">
                <button 
                  onClick={() => onSelect(p)}
                  className="w-20 h-20 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer ring-4 ring-transparent hover:ring-[var(--panel-border)] overflow-hidden"
                >
                   <UserAvatar user={p} className="w-full h-full text-3xl" />
                </button>
                <span className="theme-text-main font-medium text-sm truncate w-full text-center">{p.username}</span>
                
                <button onClick={(e) => onDelete(e, p.id)} className="absolute top-0 right-0 w-6 h-6 rounded-full bg-[var(--panel-bg)] border border-[var(--panel-border)] shadow-sm theme-text-muted hover:text-red-500 hover:border-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                   <X size={14} />
                </button>
             </div>
          ))}

          <div className="flex flex-col items-center gap-3 w-24">
             <button 
                onClick={onNew}
                className="w-20 h-20 rounded-full border-2 border-dashed border-[var(--input-border)] hover:border-blue-500 hover:bg-blue-500/5 transition-all text-[var(--text-subtle)] hover:text-blue-500 flex items-center justify-center cursor-pointer shadow-sm"
             >
                <Plus size={32} />
             </button>
             <span className="theme-text-main font-medium text-sm truncate w-full text-center">添加账户</span>
          </div>

          <div className="flex flex-col items-center gap-3 w-24">
             <button 
                onClick={onAnonymous}
                className="w-20 h-20 rounded-full bg-[var(--item-hover)] border border-[var(--input-border)] hover:bg-[var(--panel-border)] transition-all text-[var(--text-main)] flex items-center justify-center cursor-pointer shadow-sm"
             >
                <Globe size={30} className="opacity-80" />
             </button>
             <span className="theme-text-main font-medium text-sm truncate w-full text-center">匿名登录</span>
          </div>
       </div>
    </div>
  );
}

function SetupScreen({ onLogin, onBack, currentTheme, setTheme }: any) {
  const [username, setUsername] = useState('');
  const [color, setColor] = useState(PALETTE_COLORS[0]);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);

  const handleCustomAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setCustomAvatar(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) onLogin(username.trim(), customAvatar, color);
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4 antialiased overflow-hidden relative bg-[var(--page-bg)]">
      <div className="absolute top-6 left-6 z-20">
         <button onClick={onBack} className="w-10 h-10 rounded-full theme-item border border-[var(--panel-border)] flex items-center justify-center theme-text-main shadow-sm hover:scale-105 transition-transform cursor-pointer">
            <ChevronLeft size={24} />
         </button>
      </div>
      <div className="absolute top-6 right-6 z-20">
        <ThemeSwitcher currentTheme={currentTheme} setTheme={setTheme} placement="bottom" />
      </div>

      <div className="w-full max-w-md theme-panel p-8 md:p-10 shadow-2xl relative z-10 transition-all">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold tracking-tight mb-2 theme-text-main">创建账户</h1>
          <p className="theme-text-subtle text-[15px]">设置包含在本地的信息</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-center mb-2">
             <div className="relative group">
               {customAvatar ? (
                 <img src={customAvatar} className="w-24 h-24 rounded-full object-cover border-4 border-[var(--panel-bg)] shadow-md" alt="Avatar" />
               ) : (
                 <div className="w-24 h-24 rounded-full flex items-center justify-center text-4xl text-white font-bold uppercase shadow-md transition-colors" style={{ backgroundColor: color }}>
                   {username ? username.charAt(0) : '?'}
                 </div>
               )}
               
               <label className="absolute bottom-0 right-0 w-8 h-8 bg-[var(--text-main)] text-[var(--page-bg)] rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 transition-transform">
                 <input type="file" accept="image/*" className="hidden" onChange={handleCustomAvatar} />
                 <ImageIcon size={14} />
               </label>
               {customAvatar && (
                 <button type="button" onClick={() => setCustomAvatar(null)} className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg hover:scale-110 transition-transform">
                   <X size={12} />
                 </button>
               )}
             </div>
          </div>

          <div>
            <label className="block text-xs font-semibold theme-text-subtle uppercase tracking-widest mb-3 pl-1 text-center">专属标识色</label>
            <div className="flex justify-center items-center gap-3 flex-wrap px-2">
              {PALETTE_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn("w-8 h-8 rounded-full transition-all shadow-sm ring-offset-2 ring-offset-[var(--panel-bg)] cursor-pointer", color === c ? "ring-2 scale-110" : "hover:scale-110")}
                  style={{ backgroundColor: c, '--tw-ring-color': c } as React.CSSProperties}
                />
              ))}
              <label 
                className={cn("w-8 h-8 rounded-full transition-all shadow-sm ring-offset-2 ring-offset-[var(--panel-bg)] relative cursor-pointer overflow-hidden flex items-center justify-center", !PALETTE_COLORS.includes(color) ? "ring-2 scale-110" : "hover:scale-110")}
                style={{ background: 'conic-gradient(from 180deg at 50% 50%, #ff0f7b 0%, #f89b29 25%, #ffeb3b 50%, #00bcd4 75%, #a634ff 100%)', '--tw-ring-color': color } as React.CSSProperties}
              >
                <div className="absolute inset-0 bg-black/10 flex items-center justify-center text-white mix-blend-overlay"><Palette size={14} className="opacity-80" /></div>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute opacity-0 w-16 h-16 cursor-pointer" />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold theme-text-subtle uppercase tracking-widest mb-3 pl-1">用户名</label>
            <input
              type="text" required maxLength={20} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="输入一个响亮的名字"
              className="w-full theme-input rounded-2xl px-5 py-4 text-[17px] outline-none focus:ring-2 focus:border-transparent transition-all font-medium shadow-sm"
              style={{ '--tw-ring-color': color } as React.CSSProperties}
            />
          </div>

          <button
            type="submit" disabled={!username.trim()}
            className="w-full theme-primary-btn rounded-2xl py-4 font-semibold text-[17px] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] mt-4 text-white cursor-pointer transition-all"
            style={username.trim() ? { backgroundColor: color, boxShadow: `0 4px 14px ${color}40` } : {}}
          >记录身份并进入</button>
        </form>
      </div>
    </div>
  );
}

function ShareModal({ serverInfo, onClose }: { serverInfo: any, onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const localLink = `http://${serverInfo.localIp}:${serverInfo.port}`;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in transition-all">
      <div className="theme-panel w-full max-w-md p-6 rounded-[2rem] shadow-2xl flex flex-col relative overflow-hidden">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-muted cursor-pointer transition-colors block">
            <X size={20} />
        </button>
        <div className="flex flex-col items-center mb-6 mt-2">
            <div className="w-14 h-14 bg-blue-500 rounded-full flex items-center justify-center text-white mb-4 shadow-lg"><Share2 size={24} /></div>
            <h3 className="text-xl font-bold theme-text-main text-center">分享局域网服务器</h3>
            <p className="theme-text-subtle text-sm text-center mt-1 px-4">将以下地址发送给同一 Wi-Fi 下的其他设备，他们即可直接免部署进入您的聊天室。</p>
        </div>

        <div className="flex flex-col gap-3 mb-6">
            <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold theme-text-subtle uppercase tracking-wider pl-1">通用 IP 地址 (支持所有平台)</span>
                <div className="flex items-center gap-2 bg-[var(--item-hover)] border border-[var(--input-border)] p-1.5 rounded-xl">
                    <input type="text" readOnly value={localLink} className="flex-1 bg-transparent border-none outline-none text-[14px] font-mono theme-text-main px-2" />
                    <button onClick={() => handleCopy(localLink, 'ip')} className="p-2 rounded-lg bg-[var(--panel-bg)] shadow-sm theme-text-main hover:bg-blue-50 transition-colors border border-[var(--panel-border)] cursor-pointer">
                        {copied === 'ip' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                    </button>
                </div>
            </div>

            <div className="flex flex-col gap-1 mt-2">
                <span className="text-[11px] font-bold theme-text-subtle uppercase tracking-wider pl-1">智能域名 (推荐苹果/Win10+设备)</span>
                <div className="flex items-center gap-2 bg-[var(--item-hover)] border border-[var(--input-border)] p-1.5 rounded-xl">
                    <input type="text" readOnly value={serverInfo.mdnsUrl} className="flex-1 bg-transparent border-none outline-none text-[14px] font-mono theme-text-main px-2" />
                    <button onClick={() => handleCopy(serverInfo.mdnsUrl, 'mdns')} className="p-2 rounded-lg bg-[var(--panel-bg)] shadow-sm theme-text-main hover:bg-blue-50 transition-colors border border-[var(--panel-border)] cursor-pointer">
                        {copied === 'mdns' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                    </button>
                </div>
            </div>

            {serverInfo.appUrl && (
              <div className="flex flex-col gap-1 mt-2">
                  <span className="text-[11px] font-bold theme-text-subtle uppercase tracking-wider pl-1">公网测试地址</span>
                  <div className="flex items-center gap-2 bg-[var(--item-hover)] border border-[var(--input-border)] p-1.5 rounded-xl">
                      <input type="text" readOnly value={serverInfo.appUrl} className="flex-1 bg-transparent border-none outline-none text-[14px] font-mono theme-text-main px-2" />
                      <button onClick={() => handleCopy(serverInfo.appUrl, 'appUrl')} className="p-2 rounded-lg bg-[var(--panel-bg)] shadow-sm theme-text-main hover:bg-blue-50 transition-colors border border-[var(--panel-border)] cursor-pointer">
                          {copied === 'appUrl' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                      </button>
                  </div>
              </div>
            )}
        </div>

        <button onClick={onClose} className="w-full py-3.5 bg-[var(--item-hover)] hover:bg-[var(--panel-border)] theme-text-main font-semibold rounded-xl transition-colors cursor-pointer border border-[var(--input-border)] shadow-sm">
            关闭
        </button>
      </div>
    </div>
  )
}

function CreateGroupModal({ users, onClose, onCreate }: any) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleUser = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="theme-panel w-full max-w-md p-6 rounded-[2rem] shadow-2xl flex flex-col">
        <h3 className="text-xl font-bold theme-text-main mb-6">新建群组</h3>
        <input 
          autoFocus type="text" placeholder="给群起个响亮的名字" value={name} onChange={e => setName(e.target.value)}
          className="w-full theme-input rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500 mb-6 font-medium shadow-sm transition-all"
        />
        <div className="flex-1 overflow-y-auto mb-6 max-h-60 custom-scrollbar border border-[var(--panel-border)] rounded-xl p-2 hide-scrollbar">
          <p className="text-xs font-bold theme-text-subtle uppercase tracking-wider mb-2 px-2">邀请成员加入</p>
          {users.length === 0 ? (
            <p className="theme-text-muted text-sm px-2 italic">当前局域网没有其他在线好友可被邀请。</p>
          ) : (
            users.map((u: User) => (
              <label key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[var(--item-hover)] cursor-pointer transition-colors">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleUser(u.id)} className="w-4 h-4 rounded text-blue-500" />
                <UserAvatar user={u} className="w-8 h-8 text-xs" />
                <span className="theme-text-main font-medium">{u.username}</span>
              </label>
            ))
          )}
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl theme-item theme-text-main font-medium transition-colors cursor-pointer">取消</button>
          <button 
            onClick={() => onCreate(name, Array.from(selected))} disabled={!name.trim() || selected.size === 0}
            className="px-5 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer"
          >建立群聊</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmDeleteModal({ target, onConfirm, onCancel }: { target: { type: 'friend' | 'group'; id: string; name: string }, onConfirm: () => void, onCancel: () => void }) {
  const label = target.type === 'friend' ? '好友' : '群聊';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="theme-panel w-full max-w-sm p-6 rounded-[2rem] shadow-2xl flex flex-col gap-5">
        <div>
          <h3 className="text-xl font-bold theme-text-main mb-2">是否删除？</h3>
          <p className="theme-text-subtle text-sm break-words">将彻底删除本地{label}「{target.name}」及对应聊天记录。</p>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-5 py-2.5 rounded-xl theme-item theme-text-main font-medium transition-colors cursor-pointer border border-[var(--input-border)]">
            否
          </button>
          <button onClick={onConfirm} className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors shadow-md cursor-pointer">
            是
          </button>
        </div>
      </div>
    </div>
  );
}

function ForwardModal({
  draft,
  targets,
  onForward,
  onClose,
}: {
  draft: { messages: ChatMessage[]; mode: 'single' | 'separate' | 'merged' };
  targets: { id: string; name: string; detail: string }[];
  onForward: (targetId: string) => void;
  onClose: () => void;
}) {
  const title = draft.mode === 'merged' ? '合并转发' : draft.mode === 'separate' ? '逐条转发' : '转发消息';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
      <div className="theme-panel w-full max-w-md p-6 rounded-[2rem] shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-xl font-bold theme-text-main">{title}</h3>
            <p className="theme-text-subtle text-sm mt-1">选择接收会话，当前共 {draft.messages.length} 条消息。</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-[var(--item-hover)] theme-text-muted cursor-pointer transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar border border-[var(--panel-border)] rounded-xl p-2 hide-scrollbar">
          {targets.map(target => (
            <button
              key={target.id}
              onClick={() => onForward(target.id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl theme-item transition-colors cursor-pointer text-left"
            >
              <div className="w-10 h-10 rounded-full theme-global-avatar border border-[var(--input-border)] flex items-center justify-center theme-text-main shrink-0">
                {target.id === 'global' ? <Globe size={18} /> : target.id.startsWith('group_') ? <Users size={18} /> : <UserIcon size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[15px] truncate theme-text-main">{target.name}</div>
                <div className="text-xs theme-text-subtle truncate">{target.detail}</div>
              </div>
              <Forward size={16} className="theme-text-muted shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileAttachment({ preview, isMine, color }: { preview: string, isMine: boolean, color?: string }) {
  try {
    const file: Attachment = JSON.parse(preview);
    const isImage = file.mimeType.startsWith('image/');
    const isVideo = file.mimeType.startsWith('video/');

    return (
      <div className="flex flex-col gap-2 rounded-xl overflow-hidden max-w-full mt-1">
        {(isImage || isVideo) && (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block transition-opacity hover:opacity-90"
          >
            {isImage && (
              <img src={file.url} alt={file.originalName} className="block w-auto h-auto max-w-[82vw] md:max-w-[720px] max-h-[70vh] object-contain rounded-xl bg-black/5" />
            )}
            {isVideo && (
              <video src={file.url} controls preload="metadata" className="block w-auto h-auto max-w-[82vw] md:max-w-[720px] max-h-[70vh] object-contain rounded-xl bg-black/10" />
            )}
          </a>
        )}
        
        <div className={cn(
          "flex items-center gap-3 p-3 rounded-xl border",
          isMine 
            ? "bg-[rgba(255,255,255,0.1)] border-[rgba(255,255,255,0.2)] text-white" 
            : "bg-[var(--item-hover)] border-[var(--input-border)] text-[var(--text-main)]"
        )}>
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center shadow-sm shrink-0",
            isMine ? "bg-[rgba(255,255,255,0.2)]" : "bg-[var(--panel-bg)]"
          )}>
            {isImage ? <ImageIcon size={20} /> : isVideo ? <Video size={20} /> : <FileText size={20} />}
          </div>
          <div className="flex-1 flex flex-col min-w-0 max-w-[200px]">
             <span className="text-sm font-medium truncate">{file.originalName}</span>
             <span className={cn("text-[10px] truncate", isMine ? "text-[rgba(255,255,255,0.8)]" : "theme-text-muted")}>{formatBytes(file.size)}</span>
          </div>
          <a
            href={file.url}
            download={file.originalName}
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer",
              isMine ? "bg-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.3)] text-white" : "bg-[var(--panel-bg)] hover:bg-blue-500/10 text-[var(--text-main)]"
            )}
            title="下载原文件"
          >
            <Download size={18} />
          </a>
        </div>
      </div>
    );
  } catch (e) {
    return <span className="theme-text-muted text-sm italic">无效的附件文件</span>;
  }
}
