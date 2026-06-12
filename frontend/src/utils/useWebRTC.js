// useWebRTC.js - Native WebRTC hook (no external deps)
import { useRef, useState } from 'react';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export function useWebRTC(socket, userId) {
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [callState, setCallState] = useState(null); // null | 'outgoing' | 'incoming' | 'ongoing'
  const [callMeta, setCallMeta] = useState(null);   // { from, name, isVideo }
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const cleanup = () => {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    setCallState(null);
    setCallMeta(null);
  };

  const createPC = (stream, onIceCandidate) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) onIceCandidate(e.candidate); };
    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };
    return pc;
  };

  const startCall = async (receiverId, isVideo) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).catch(() => null);
    if (!stream) return alert('Camera/Mic access denied');
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = createPC(stream, (candidate) => {
      socket.current?.emit('iceCandidate', { to: receiverId, candidate });
    });
    pcRef.current = pc;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.current?.emit('callUser', { to: receiverId, from: userId, offer, isVideo });
    setCallState('outgoing');
    setCallMeta({ receiverId, isVideo });
  };

  const answerCall = async () => {
    const { from, offer, isVideo } = callMeta;
    const stream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).catch(() => null);
    if (!stream) return;
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = createPC(stream, (candidate) => {
      socket.current?.emit('iceCandidate', { to: from, candidate });
    });
    pcRef.current = pc;

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.current?.emit('answerCall', { to: from, answer });
    setCallState('ongoing');
  };

  const handleOffer = (data) => {
    setCallMeta({ from: data.from, name: data.name, offer: data.offer, isVideo: data.isVideo });
    setCallState('incoming');
  };

  const handleAnswer = async (answer) => {
    await pcRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    setCallState('ongoing');
  };

  const handleIceCandidate = async (candidate) => {
    try { await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  };

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    tracks.forEach(t => { t.enabled = !t.enabled; });
    setIsMuted(m => !m);
  };

  const toggleVideo = () => {
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    tracks.forEach(t => { t.enabled = !t.enabled; });
    setIsVideoOff(v => !v);
  };

  return {
    callState, callMeta, isMuted, isVideoOff,
    localVideoRef, remoteVideoRef,
    startCall, answerCall, endCall: cleanup,
    handleOffer, handleAnswer, handleIceCandidate,
    toggleMute, toggleVideo,
  };
}
