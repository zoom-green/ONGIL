import { useCallback, useEffect, useRef, useState } from 'react';
import type { Persona } from '../utils/companionPersona';

export type RealtimePhase = 'idle' | 'connecting' | 'listening' | 'speaking';

interface UseRealtimeCompanionOptions {
  persona: Persona;
  onEnd: () => void;
  onUserTranscript?: (text: string) => void;
}

function extractTranscript(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const message = event as {
    type?: string;
    transcript?: unknown;
    item?: { content?: Array<{ transcript?: unknown; text?: unknown }> };
  };
  if (message.type === 'conversation.item.input_audio_transcription.completed' && typeof message.transcript === 'string') {
    return message.transcript;
  }
  const content = message.item?.content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (typeof part.transcript === 'string') return part.transcript;
    if (typeof part.text === 'string') return part.text;
  }
  return null;
}

export function useRealtimeCompanion({ persona, onEnd, onUserTranscript }: UseRealtimeCompanionOptions) {
  const [phase, setPhase] = useState<RealtimePhase>('idle');
  const [callSecs, setCallSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [callStarted, setCallStarted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  const onUserTranscriptRef = useRef(onUserTranscript);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    onUserTranscriptRef.current = onUserTranscript;
  }, [onUserTranscript]);

  useEffect(() => {
    if (!callStarted) return;
    const timer = window.setInterval(() => setCallSecs((secs) => secs + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callStarted]);

  const fmt = useCallback((secs: number) => {
    const min = Math.floor(secs / 60).toString().padStart(2, '0');
    const sec = (secs % 60).toString().padStart(2, '0');
    return `${min}:${sec}`;
  }, []);

  const cleanup = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    pcRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
  }, []);

  const endCall = useCallback(() => {
    endedRef.current = true;
    cleanup();
    setCallStarted(false);
    setPhase('idle');
    setCallSecs(0);
    onEndRef.current();
  }, [cleanup]);

  const startCall = useCallback(async () => {
    if (callStarted || phase === 'connecting') return;

    endedRef.current = false;
    setError(null);
    setPhase('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('이 브라우저는 마이크 연결을 지원하지 않아요.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = stream;

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteAudioRef.current && remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => {
            setError('AI 음성을 재생하지 못했어요. 화면을 한 번 누른 뒤 다시 시도해 주세요.');
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setPhase('listening');
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !endedRef.current) {
          setError('통화 연결이 끊어졌어요.');
          endCall();
        }
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'response.audio.delta') setPhase('speaking');
          if (message.type === 'response.audio.done') setPhase('listening');
          if (message.type === 'input_audio_buffer.speech_started') setPhase('listening');
          const transcript = extractTranscript(message);
          if (transcript) onUserTranscriptRef.current?.(transcript);
          if (message.type === 'error') {
            setError(message.error?.message ?? 'Realtime 오류가 발생했어요.');
          }
        } catch {
          // The data channel can carry events we do not need for the UI.
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const realtimeRes = await fetch(`/api/realtime-call?persona=${encodeURIComponent(persona)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!realtimeRes.ok) {
        const text = await realtimeRes.text();
        throw new Error(text || 'OpenAI Realtime 연결에 실패했어요.');
      }

      const answer = await realtimeRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      setCallStarted(true);
      setCallSecs(0);
      setPhase('listening');
    } catch (err) {
      cleanup();
      setCallStarted(false);
      setPhase('idle');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Permission') || message.includes('NotAllowed')) {
        setError('마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.');
      } else {
        setError(message);
      }
    }
  }, [callStarted, cleanup, endCall, persona, phase]);

  useEffect(() => {
    return () => {
      endedRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  return {
    phase,
    callSecs,
    error,
    callStarted,
    startCall,
    endCall,
    fmt,
  };
}
