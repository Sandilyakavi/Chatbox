import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useChatStore } from '../store/useChatStore';
import { useWebRTC } from '../utils/useWebRTC';
import { IncomingCall, OutgoingCall, OngoingCall } from '../components/CallOverlay';
import { io } from 'socket.io-client';
import { format, isToday, isYesterday } from 'date-fns';
import { LogOut, Send, Search, Phone, Video, Paperclip, MessageCircle, Users, X, File as FileIcon, Trash2, UserPlus, Settings, Shield } from 'lucide-react';
import { encryptText, decryptText } from '../utils/crypto';

const API = 'https://chatbox-3uwt.onrender.com';
const EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

const getInitial = (n) => n?.[0]?.toUpperCase() || '?';
const getAvatarColor = (name) => {
  const colors = ['#7c6cf0','#5b8dee','#ec4899','#f97316','#10b981','#06b6d4'];
  let h = 0; for (let c of (name||'')) h = c.charCodeAt(0)+((h<<5)-h);
  return colors[Math.abs(h)%colors.length];
};
const formatDay = (d) => {
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date,'MMMM d, yyyy');
};
const groupReactions = (r) => {
  if (!r) return [];
  const map = {};
  Object.values(r).forEach(e => { map[e]=(map[e]||0)+1; });
  return Object.entries(map);
};

export default function Chat() {
  const { user, token, logout, updateUser } = useAuthStore();
  const { currentConversation, setCurrentConversation, messages, setMessages, addMessage, onlineUsers, setOnlineUsers } = useChatStore();
  const socket = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimer = useRef(null);

  const [conversations, setConversations] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [theme, setTheme] = useState('theme-dark');
  const [selectedFile, setSelectedFile] = useState(null);
  const [emojiTarget, setEmojiTarget] = useState(null);
  
  // Group creation modal state
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupSearchResults, setGroupSearchResults] = useState([]);

  // Add members to existing group state
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addMemberResults, setAddMemberResults] = useState([]);

  // Profile Settings state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileUsername, setProfileUsername] = useState(user?.username || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profilePassword, setProfilePassword] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const rtc = useWebRTC(socket, user.id);

  const friend = currentConversation?.members?.find(m => m._id !== user.id);
  const isOnline = (id) => onlineUsers.includes(id);

  // ── Fetch conversations ──────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/conversations/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await r.json();
      if (Array.isArray(data)) {
        setConversations(data);
        // Securely join socket rooms for all retrieved conversations
        socket.current?.emit('joinRooms', data.map(c => c._id));
      }
    } catch (err) {
      console.error('Error fetching conversations:', err);
    }
  }, [user.id, token]);

  // ── Init socket ──────────────────────────────────────────────
  useEffect(() => {
    socket.current = io(API, {
      auth: { token: token }
    });
    
    socket.current.emit('addUser', user.id);

    socket.current.on('getUsers', users => setOnlineUsers(users));
    
    socket.current.on('typing', ({ conversationId, userId }) =>
      setTypingUsers(p => ({ ...p, [conversationId]: userId })));
    
    socket.current.on('stopTyping', ({ conversationId }) =>
      setTypingUsers(p => { const n={...p}; delete n[conversationId]; return n; }));

    // Secure E2EE message receiver
    socket.current.on('getMessage', async (data) => {
      // Find E2EE key for this conversation
      let key = null;
      if (currentConversation && currentConversation._id === data.conversationId) {
        key = currentConversation.encryptionKey;
      } else {
        const conv = conversations.find(c => c._id === data.conversationId);
        key = conv?.encryptionKey;
      }

      const decryptedText = await decryptText(data.text, key);

      if (currentConversation && currentConversation._id === data.conversationId) {
        addMessage({
          _id: data.messageId,
          sender: { _id: data.senderId, username: data.senderName },
          text: decryptedText,
          fileUrl: data.fileUrl,
          fileType: data.fileType,
          createdAt: data.createdAt,
          reactions: {}
        });
      }
      fetchConversations();
    });

    // Message deletion listener
    socket.current.on('messageDeleted', ({ messageId, conversationId }) => {
      if (currentConversation && currentConversation._id === conversationId) {
        setMessages(prev => prev.filter(m => m._id !== messageId));
      }
    });

    // Group update listener (sync members list)
    socket.current.on('groupUpdated', ({ conversationId, updatedConversation }) => {
      if (currentConversation && currentConversation._id === conversationId) {
        setCurrentConversation(updatedConversation);
      }
      setConversations(prev => prev.map(c => c._id === conversationId ? updatedConversation : c));
    });

    // WebRTC events
    socket.current.on('callUser', rtc.handleOffer);
    socket.current.on('callAnswered', ({ answer }) => rtc.handleAnswer(answer));
    socket.current.on('iceCandidate', ({ candidate }) => rtc.handleIceCandidate(candidate));
    socket.current.on('callEnded', () => rtc.endCall());

    return () => socket.current.disconnect();
  }, [currentConversation, conversations, fetchConversations, rtc, token, user.id, setOnlineUsers, addMessage, setMessages, setCurrentConversation]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // ── Fetch and decrypt messages ───────────────────────────────
  useEffect(() => {
    if (!currentConversation) return;
    fetch(`${API}/api/messages/${currentConversation._id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(async (data) => {
        if (Array.isArray(data)) {
          // Decrypt messages before loading to state
          const decrypted = await Promise.all(data.map(async m => {
            const decText = await decryptText(m.text, currentConversation.encryptionKey);
            return { ...m, text: decText };
          }));
          setMessages(decrypted);
        } else {
          setMessages([]);
        }
      })
      .catch(err => console.error("Error loading messages:", err));
  }, [currentConversation, token]);

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages]);

  // ── Search Users ─────────────────────────────────────────────
  const handleSearch = async (e) => {
    const q = e.target.value; setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const r = await fetch(`${API}/api/auth/users?search=${q}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    setSearchResults(data.filter(u => u._id !== user.id));
  };

  const startConversation = async (receiverId) => {
    const r = await fetch(`${API}/api/conversations`, {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ senderId: user.id, receiverId }),
    });
    const conv = await r.json();
    setSearchQuery(''); setSearchResults([]);
    await fetchConversations();
    setCurrentConversation(conv);
  };

  // ── Typing ───────────────────────────────────────────────────
  const handleTyping = (e) => {
    setNewMessage(e.target.value);
    if (!currentConversation) return;
    socket.current?.emit('typing', { conversationId: currentConversation._id, userId: user.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() =>
      socket.current?.emit('stopTyping', { conversationId: currentConversation._id }), 1500);
  };

  // ── Send message (E2EE Encrypted) ────────────────────────────
  const handleSend = async (e) => {
    e.preventDefault();
    if (!currentConversation || (!newMessage.trim() && !selectedFile)) return;
    let fileUrl = null, fileType = null;

    if (selectedFile) {
      const form = new FormData(); form.append('file', selectedFile);
      const up = await fetch(`${API}/api/messages/upload`, {
        method:'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: form
      });
      const upData = await up.json();
      fileUrl = upData.url;
      fileType = selectedFile.type.startsWith('image/') ? 'image' : 'file';
      setSelectedFile(null);
    }

    // Encrypt raw message text using active conversation's E2EE symmetric key
    const encryptedText = await encryptText(newMessage.trim(), currentConversation.encryptionKey);

    // Save encrypted message to DB
    const r = await fetch(`${API}/api/messages`, {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({
        conversationId: currentConversation._id,
        sender: user.id,
        text: encryptedText,
        fileUrl,
        fileType
      }),
    });
    const savedMsg = await r.json();

    // Broadcast encrypted text through WebSockets (E2EE in transit)
    socket.current?.emit('sendMessage', {
      senderId: user.id,
      senderName: user.username,
      text: encryptedText,
      conversationId: currentConversation._id,
      fileUrl,
      fileType,
      messageId: savedMsg._id
    });
    socket.current?.emit('stopTyping', { conversationId: currentConversation._id });

    // Render plain text locally for sender
    addMessage({ ...savedMsg, text: newMessage.trim() });
    setNewMessage('');
    fetchConversations();
  };

  // ── Message Deletion ─────────────────────────────────────────
  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm("Are you sure you want to delete this message?")) return;
    try {
      const r = await fetch(`${API}/api/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (r.ok) {
        // Emit to socket room for real-time deletion
        socket.current?.emit('deleteMessage', { messageId, conversationId: currentConversation._id });
        // Update local state
        setMessages(prev => prev.filter(m => m._id !== messageId));
      } else {
        const err = await r.json();
        alert(err.message || "Could not delete message");
      }
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  };

  // ── Reactions ────────────────────────────────────────────────
  const handleReaction = async (msgId, emoji) => {
    setEmojiTarget(null);
    await fetch(`${API}/api/messages/${msgId}/react`, {
      method:'PUT',
      headers:{
        'Authorization': `Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ userId: user.id, emoji }),
    });
    setMessages(messages.map(m => m._id !== msgId ? m : { ...m, reactions: { ...(m.reactions||{}), [user.id]: emoji } }));
  };

  // ── Create group ─────────────────────────────────────────────
  const handleGroupSearch = async (e) => {
    const q = e.target.value; setGroupSearchQuery(q);
    if (!q.trim()) { setGroupSearchResults([]); return; }
    const r = await fetch(`${API}/api/auth/users?search=${q}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    setGroupSearchResults(data.filter(u => u._id !== user.id));
  };

  const createGroup = async () => {
    if (!groupName.trim() || groupMembers.length < 1) return;
    const r = await fetch(`${API}/api/conversations`, {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${token}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ senderId: user.id, isGroup: true, groupName, members: [user.id, ...groupMembers] }),
    });
    const newConv = await r.json();
    setShowGroupModal(false); setGroupName(''); setGroupMembers([]); setGroupSearchQuery(''); setGroupSearchResults([]);
    await fetchConversations();
    setCurrentConversation(newConv);
  };

  // ── Add members to existing group ────────────────────────────
  const handleAddMemberSearch = async (e) => {
    const q = e.target.value; setAddMemberSearch(q);
    if (!q.trim()) { setAddMemberResults([]); return; }
    const r = await fetch(`${API}/api/auth/users?search=${q}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await r.json();
    // Exclude users already in the group
    const currentMembers = currentConversation.members.map(m => m._id);
    setAddMemberResults(data.filter(u => !currentMembers.includes(u._id)));
  };

  const addMembersToGroup = async (newMemberId) => {
    try {
      const r = await fetch(`${API}/api/conversations/${currentConversation._id}/members`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ newMemberIds: [newMemberId] })
      });
      if (r.ok) {
        const updatedConv = await r.json();
        setCurrentConversation(updatedConv);
        // Sync online members with socket update
        socket.current?.emit('groupUpdate', { conversationId: currentConversation._id, updatedConversation: updatedConv });
        
        // Refresh local UI and list
        setConversations(prev => prev.map(c => c._id === currentConversation._id ? updatedConv : c));
        setAddMemberSearch('');
        setAddMemberResults([]);
        setShowAddMemberModal(false);
      } else {
        const errorMsg = await r.json();
        alert(errorMsg.message || "Failed to add member");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // ── Edit Profile ─────────────────────────────────────────────
  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    
    if (profileUsername.trim().length < 3) {
      setProfileError("Username must be at least 3 characters");
      return;
    }

    try {
      const r = await fetch(`${API}/api/auth/update`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: profileUsername,
          email: profileEmail,
          password: profilePassword || undefined
        })
      });

      const data = await r.json();
      if (r.ok) {
        updateUser(data.user, data.token);
        setProfileSuccess("Profile updated successfully!");
        setProfilePassword('');
        setTimeout(() => {
          setShowProfileModal(false);
          setProfileSuccess('');
        }, 1200);
      } else {
        setProfileError(data.message || "Profile update failed");
      }
    } catch (err) {
      setProfileError("Server connection error");
    }
  };

  // ── Render messages ──────────────────────────────────────────
  const renderMessages = () => {
    const items = []; let lastDay = null;
    messages.forEach((m, i) => {
      const day = formatDay(m.createdAt);
      if (day !== lastDay) { lastDay = day; items.push(<div key={`d${i}`} className="day-divider">{day}</div>); }
      const isOwn = (m.sender?._id || m.sender) === user.id;
      const reactions = groupReactions(m.reactions);
      items.push(
        <div key={m._id||i} className={`msg-row ${isOwn?'own':'other'} msg-hover-container`}>
          {!isOwn && <div className="avatar avatar-sm" style={{background:getAvatarColor(m.sender?.username)}}>{getInitial(m.sender?.username)}</div>}
          <div className="msg-bubble-wrap">
            <div className="msg-bubble" style={{position:'relative'}} onDoubleClick={() => setEmojiTarget(emojiTarget===m._id?null:m._id)}>
              {m.fileUrl && m.fileType==='image' && <img src={`${API}${m.fileUrl}`} alt="img" className="msg-file-img"/>}
              {m.fileUrl && m.fileType==='file' && <a href={`${API}${m.fileUrl}`} target="_blank" rel="noreferrer" className="msg-file-link"><FileIcon size={16}/>Download file</a>}
              {m.text && <span>{m.text}</span>}
              <div className="msg-meta">{format(new Date(m.createdAt),'h:mm a')}</div>
              {emojiTarget===m._id && (
                <div className="emoji-popover">
                  {EMOJIS.map(e => <button key={e} className="emoji-btn" onClick={() => handleReaction(m._id, e)}>{e}</button>)}
                </div>
              )}
            </div>
            {reactions.length > 0 && <div className="msg-reactions">{reactions.map(([e,c]) => <span key={e} className="reaction-chip">{e} {c}</span>)}</div>}
          </div>
          {isOwn && m._id && (
            <button 
              className="msg-delete-btn" 
              onClick={() => handleDeleteMessage(m._id)}
              title="Delete message"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      );
    });
    return items;
  };

  const THEMES = [
    { id:'theme-dark', color:'#7c6cf0', label:'Dark' },
    { id:'theme-light', color:'#e8e8f3', label:'Light' },
    { id:'theme-ocean', color:'#38bdf8', label:'Ocean' },
  ];

  return (
    <div className={`chat-app ${theme}`}>
      <style>{`
        .msg-hover-container {
          position: relative;
          display: flex;
          align-items: center;
        }
        .msg-hover-container .msg-delete-btn {
          opacity: 0;
          transition: opacity 0.2s ease, transform 0.1s ease;
          background: rgba(239, 68, 68, 0.1);
          border: none;
          color: #ef4444;
          cursor: pointer;
          padding: 6px;
          margin-left: 8px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .msg-hover-container:hover .msg-delete-btn {
          opacity: 1;
        }
        .msg-delete-btn:hover {
          background: #ef4444 !important;
          color: white !important;
          transform: scale(1.1);
        }
        .e2ee-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          color: #10b981;
          background: rgba(16, 185, 129, 0.12);
          padding: 4px 10px;
          border-radius: 9999px;
          font-weight: 500;
          border: 1px solid rgba(16, 185, 129, 0.2);
          margin-left: 12px;
        }
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: 16px 0;
        }
        .settings-label {
          font-size: 0.8rem;
          color: var(--text-secondary);
          margin-bottom: -6px;
          text-align: left;
          font-weight: 500;
        }
        .alert-error {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          padding: 8px;
          border-radius: 6px;
          font-size: 0.8rem;
        }
        .alert-success {
          color: #10b981;
          background: rgba(16, 185, 129, 0.1);
          padding: 8px;
          border-radius: 6px;
          font-size: 0.8rem;
        }
      `}</style>

      {/* SIDEBAR */}
      <div className="sidebar">
        <div className="sidebar-top">
          <span className="sidebar-brand">💬 ChatApp</span>
          <div style={{display:'flex',gap:4}}>
            <button className="icon-btn" onClick={()=>setShowGroupModal(true)} title="New Group"><Users size={18}/></button>
            <button className="icon-btn" onClick={()=>setShowProfileModal(true)} title="Profile Settings"><Settings size={18}/></button>
            <button className="icon-btn danger" onClick={logout} title="Logout"><LogOut size={18}/></button>
          </div>
        </div>

        <div className="sidebar-search">
          <div className="search-input-wrap">
            <Search size={15} className="search-icon"/>
            <input className="search-input" placeholder="Search users…" value={searchQuery} onChange={handleSearch}/>
          </div>
        </div>

        <div className="conv-list">
          {(searchQuery ? searchResults : conversations).map(item => {
            const isResult = !!searchQuery;
            const name = isResult ? item.username : (item.isGroup ? item.groupName : item.members?.find(m=>m._id!==user.id)?.username);
            const memberId = isResult ? item._id : item.members?.find(m=>m._id!==user.id)?._id;
            const online = !isResult && !item.isGroup && isOnline(memberId);
            return (
              <div key={item._id} className={`conv-item ${!isResult && currentConversation?._id===item._id?'active':''}`}
                onClick={() => isResult ? startConversation(item._id) : setCurrentConversation(item)}>
                <div className="avatar" style={{background:getAvatarColor(name)}}>
                  {getInitial(name)}
                  {online && <div className="online-dot"/>}
                </div>
                <div className="conv-info">
                  <div className="conv-name">{name||'Unknown'}</div>
                  <div className="conv-preview">{isResult ? 'Click to start chat' : item.isGroup ? 'Group chat' : 'Tap to open'}</div>
                </div>
              </div>
            );
          })}
          {!searchQuery && conversations.length===0 && (
            <p style={{textAlign:'center',padding:'2rem',color:'var(--text-muted)',fontSize:'0.85rem'}}>Search users to start chatting</p>
          )}
        </div>

        <div className="theme-bar">
          <span style={{fontSize:'0.72rem',color:'var(--text-muted)',marginRight:4}}>Theme</span>
          {THEMES.map(t => <div key={t.id} className={`theme-dot ${theme===t.id?'active':''}`} style={{background:t.color}} title={t.label} onClick={()=>setTheme(t.id)}/>)}
        </div>
      </div>

      {/* MAIN */}
      <div className="chat-main">
        {currentConversation ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info" style={{flex: 1}}>
                <div className="avatar" style={{background:getAvatarColor(friend?.username||currentConversation.groupName)}}>
                  {getInitial(friend?.username||currentConversation.groupName)}
                  {friend && isOnline(friend._id) && <div className="online-dot"/>}
                </div>
                <div>
                  <div style={{display:'flex', alignItems:'center'}}>
                    <div className="chat-header-name">{friend?.username||currentConversation.groupName}</div>
                    <div className="e2ee-badge" title="End-to-End Encrypted with 256-bit AES-GCM">
                      <Shield size={12} fill="#10b981" /> E2EE
                    </div>
                  </div>
                  <div className={`chat-header-status ${friend&&isOnline(friend._id)?'online':''}`}>
                    {currentConversation.isGroup ? `${currentConversation.members?.length} members` : (friend&&isOnline(friend._id)?'Online':'Offline')}
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                {currentConversation.isGroup && (
                  <button className="icon-btn" title="Add Members" onClick={()=>setShowAddMemberModal(true)}><UserPlus size={19}/></button>
                )}
                <button className="icon-btn" title="Voice Call" onClick={()=>friend&&rtc.startCall(friend._id,false)}><Phone size={19}/></button>
                <button className="icon-btn" title="Video Call" onClick={()=>friend&&rtc.startCall(friend._id,true)}><Video size={19}/></button>
              </div>
            </div>

            <div className="messages-area" onClick={()=>setEmojiTarget(null)}>
              {renderMessages()}
              {typingUsers[currentConversation._id] && typingUsers[currentConversation._id]!==user.id && (
                <div className="msg-row other">
                  <div className="typing-indicator">
                    <div className="typing-dot"/><div className="typing-dot"/><div className="typing-dot"/>
                  </div>
                </div>
              )}
              <div ref={scrollRef}/>
            </div>

            {selectedFile && (
              <div className="file-preview">
                <FileIcon size={16} color="var(--accent)"/>
                <span className="file-preview-name">{selectedFile.name}</span>
                <button className="file-preview-close" onClick={()=>setSelectedFile(null)}><X size={14}/></button>
              </div>
            )}

            <form className="input-area" onSubmit={handleSend}>
              <input type="file" ref={fileInputRef} style={{display:'none'}} onChange={e=>setSelectedFile(e.target.files[0])}/>
              <button type="button" className="icon-btn" style={{color:'var(--text-secondary)'}} onClick={()=>fileInputRef.current?.click()}><Paperclip size={19}/></button>
              <textarea className="msg-input" placeholder="Type an encrypted message…" rows={1} value={newMessage} onChange={handleTyping}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend(e);}}}/>
              <button type="submit" className="send-btn" disabled={!newMessage.trim()&&!selectedFile}><Send size={18}/></button>
            </form>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><MessageCircle size={36}/></div>
            <h2>Your Messages</h2>
            <p>Search for a user or select a conversation to start</p>
          </div>
        )}
      </div>

      {/* CALL UI */}
      {rtc.callState==='incoming' && (
        <IncomingCall callMeta={rtc.callMeta} onAnswer={rtc.answerCall} onReject={rtc.endCall}/>
      )}
      {rtc.callState==='outgoing' && (
        <OutgoingCall friendName={friend?.username} onEnd={()=>{socket.current?.emit('endCall',{to:friend?._id});rtc.endCall();}}/>
      )}
      {rtc.callState==='ongoing' && (
        <OngoingCall
          localVideoRef={rtc.localVideoRef} remoteVideoRef={rtc.remoteVideoRef}
          friendName={friend?.username||rtc.callMeta?.name}
          isMuted={rtc.isMuted} isVideoOff={rtc.isVideoOff}
          onMute={rtc.toggleMute} onVideo={rtc.toggleVideo}
          onEnd={()=>{socket.current?.emit('endCall',{to:friend?._id||rtc.callMeta?.from});rtc.endCall();}}
        />
      )}

      {/* CREATE GROUP MODAL */}
      {showGroupModal && (
        <div className="modal-overlay" onClick={()=>setShowGroupModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Create Group Chat</h3>
            <input className="modal-input" placeholder="Group name" value={groupName} onChange={e=>setGroupName(e.target.value)}/>
            <input className="modal-input" placeholder="Search members by username…" value={groupSearchQuery} onChange={handleGroupSearch}/>
            <div style={{maxHeight:'160px', overflowY:'auto', margin:'8px 0'}}>
              {groupSearchResults.map(u=>(
                <div key={u._id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0'}}>
                  <span>{u.username}</span>
                  <button className={groupMembers.includes(u._id)?'btn-ghost':'btn-primary'} style={{padding:'4px 12px',fontSize:'0.8rem'}}
                    onClick={()=>setGroupMembers(p=>p.includes(u._id)?p.filter(id=>id!==u._id):[...p,u._id])}>
                    {groupMembers.includes(u._id)?'Remove':'Add'}
                  </button>
                </div>
              ))}
            </div>
            <p style={{fontSize:'0.8rem',color:'var(--text-muted)',marginTop:8}}>{groupMembers.length} member(s) added</p>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setShowGroupModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={createGroup}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD MEMBERS MODAL (EXISTING GROUP) */}
      {showAddMemberModal && (
        <div className="modal-overlay" onClick={()=>setShowAddMemberModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Add Members to Group</h3>
            <input className="modal-input" placeholder="Search members by username…" value={addMemberSearch} onChange={handleAddMemberSearch}/>
            <div style={{maxHeight:'200px', overflowY:'auto', margin:'8px 0'}}>
              {addMemberResults.map(u=>(
                <div key={u._id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0'}}>
                  <span>{u.username}</span>
                  <button className="btn-primary" style={{padding:'4px 12px',fontSize:'0.8rem'}}
                    onClick={()=>addMembersToGroup(u._id)}>
                    Add Member
                  </button>
                </div>
              ))}
              {addMemberSearch.trim() && addMemberResults.length === 0 && (
                <p style={{textAlign:'center', fontSize:'0.8rem', color:'var(--text-muted)', padding:'10px'}}>No users found</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={()=>setShowAddMemberModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* PROFILE SETTINGS MODAL */}
      {showProfileModal && (
        <div className="modal-overlay" onClick={()=>setShowProfileModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Profile Settings</h3>
            <form className="settings-form" onSubmit={handleUpdateProfile}>
              {profileError && <div className="alert-error">{profileError}</div>}
              {profileSuccess && <div className="alert-success">{profileSuccess}</div>}
              
              <label className="settings-label">Username</label>
              <input className="modal-input" placeholder="Username" value={profileUsername} onChange={e=>setProfileUsername(e.target.value)} required/>
              
              <label className="settings-label">Email Address</label>
              <input className="modal-input" placeholder="Email" type="email" value={profileEmail} onChange={e=>setProfileEmail(e.target.value)} required/>
              
              <label className="settings-label">New Password (leave blank to keep current)</label>
              <input className="modal-input" placeholder="New Password" type="password" value={profilePassword} onChange={e=>setProfilePassword(e.target.value)}/>
              
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={()=>setShowProfileModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
