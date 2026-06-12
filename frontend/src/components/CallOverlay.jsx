import React from 'react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

function getInitial(name) { return name ? name[0].toUpperCase() : '?'; }
function getAvatarColor(name) {
  const colors = ['#7c6cf0','#5b8dee','#ec4899','#f97316','#10b981','#06b6d4'];
  let h = 0;
  for (let c of (name||'')) h = c.charCodeAt(0) + ((h<<5)-h);
  return colors[Math.abs(h) % colors.length];
}

export function IncomingCall({ callMeta, onAnswer, onReject }) {
  return (
    <div className="incoming-call">
      <div className="avatar" style={{ width:54,height:54,fontSize:'1.3rem',margin:'0 auto',background:getAvatarColor(callMeta?.name) }}>
        {getInitial(callMeta?.name)}
      </div>
      <h4>{callMeta?.name}</h4>
      <p>{callMeta?.isVideo ? 'Incoming video call…' : 'Incoming voice call…'}</p>
      <div className="call-actions">
        <button className="call-btn" style={{background:'var(--online)'}} onClick={onAnswer}><Phone size={22}/></button>
        <button className="call-btn" style={{background:'var(--danger)'}} onClick={onReject}><PhoneOff size={22}/></button>
      </div>
    </div>
  );
}

export function OutgoingCall({ friendName, onEnd }) {
  return (
    <div className="call-overlay">
      <div style={{textAlign:'center',color:'#fff'}}>
        <div className="avatar" style={{width:80,height:80,fontSize:'2rem',margin:'0 auto 16px',background:getAvatarColor(friendName)}}>
          {getInitial(friendName)}
        </div>
        <h2 style={{marginBottom:8}}>{friendName}</h2>
        <p style={{color:'rgba(255,255,255,0.6)'}}>Calling…</p>
      </div>
      <div className="call-controls" style={{marginTop:24}}>
        <button className="call-btn end" onClick={onEnd}><PhoneOff size={24}/></button>
      </div>
    </div>
  );
}

export function OngoingCall({ localVideoRef, remoteVideoRef, friendName, isMuted, isVideoOff, onMute, onVideo, onEnd }) {
  return (
    <div className="call-overlay">
      <div className="call-video-grid">
        <div className="call-video-box">
          <video ref={remoteVideoRef} autoPlay playsInline style={{width:'100%',height:'100%',objectFit:'cover'}}/>
          <div className="call-video-label">{friendName}</div>
        </div>
        <div className="call-video-box">
          <video ref={localVideoRef} autoPlay muted playsInline style={{width:'100%',height:'100%',objectFit:'cover'}}/>
          <div className="call-video-label">You</div>
        </div>
      </div>
      <div className="call-controls">
        <button className="call-btn mute" onClick={onMute}>{isMuted?<MicOff size={22}/>:<Mic size={22}/>}</button>
        <button className="call-btn end" onClick={onEnd}><PhoneOff size={24}/></button>
        <button className="call-btn mute" onClick={onVideo}>{isVideoOff?<VideoOff size={22}/>:<Video size={22}/>}</button>
      </div>
    </div>
  );
}
