// Android APK 빌드 시 VITE_API_BASE=https://your-app.vercel.app 설정
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export const CHARACTER_VOICE_IDS: Record<string, string> = {
  friend:    import.meta.env.VITE_XI_VOICE_FRIEND    ?? '',
  boyfriend: import.meta.env.VITE_XI_VOICE_BOYFRIEND ?? '',
  mom:       import.meta.env.VITE_XI_VOICE_MOM       ?? '',
  dad:       import.meta.env.VITE_XI_VOICE_DAD       ?? '',
};

let currentAudio: HTMLAudioElement | null = null;
// cancelTTS 호출마다 증가 → 진행 중인 fetch를 무효화
let ttsGeneration = 0;

export function cancelTTS() {
  ttsGeneration++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();
}

export async function speakText(
  text: string,
  voiceId: string | undefined,
  onDone: () => void
): Promise<void> {
  if (voiceId) {
    await speakElevenLabs(text, voiceId, onDone);
  } else {
    speakBrowser(text, onDone);
  }
}

async function speakElevenLabs(text: string, voiceId: string, onDone: () => void) {
  const myGen = ttsGeneration;

  let called = false;
  const done = () => { if (!called) { called = true; onDone(); } };
  const safetyTimer = setTimeout(done, Math.max(text.length * 150, 8000));

  try {
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceId,
        text,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
      }),
    });

    if (ttsGeneration !== myGen) { clearTimeout(safetyTimer); return; }
    if (!res.ok) throw new Error(`TTS ${res.status}`);

    const blob = await res.blob();
    if (ttsGeneration !== myGen) { clearTimeout(safetyTimer); return; }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    const finish = () => {
      clearTimeout(safetyTimer);
      URL.revokeObjectURL(url);
      currentAudio = null;
      done();
    };

    audio.onended = finish;
    audio.onerror = () => {
      clearTimeout(safetyTimer);
      URL.revokeObjectURL(url);
      currentAudio = null;
      if (ttsGeneration === myGen) speakBrowser(text, done);
      else done();
    };
    // Chrome에서 onended가 가끔 안 터지므로 timeupdate로 재생 끝 감지
    audio.addEventListener('timeupdate', () => {
      if (audio.duration > 0 && audio.currentTime >= audio.duration - 0.15) finish();
    });

    await audio.play();
  } catch {
    clearTimeout(safetyTimer);
    if (ttsGeneration === myGen) speakBrowser(text, done);
  }
}

function getBestKoreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return (
    voices.find((v) => v.name === 'Yuna') ||
    voices.find((v) => v.name.includes('Yuna')) ||
    voices.find((v) => v.name.includes('YuJin')) ||
    voices.find((v) => v.name.includes('Heami')) ||
    voices.find((v) => v.lang === 'ko-KR' && v.localService) ||
    voices.find((v) => v.lang === 'ko-KR') ||
    null
  );
}

export function speakBrowser(text: string, onDone: () => void) {
  if (!window.speechSynthesis) { onDone(); return; }
  window.speechSynthesis.cancel();

  let called = false;
  const done = () => { if (!called) { called = true; onDone(); } };
  const safetyMs = Math.max(text.length * 300, 5000);
  const safetyTimer = setTimeout(done, safetyMs);

  const start = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 0.88;
    utter.pitch = 1.05;
    utter.volume = 1.0;
    const voice = getBestKoreanVoice();
    if (voice) utter.voice = voice;
    utter.onend = () => { clearTimeout(safetyTimer); done(); };
    utter.onerror = () => { clearTimeout(safetyTimer); done(); };
    window.speechSynthesis.speak(utter);
  };

  if (window.speechSynthesis.getVoices().length > 0) start();
  else window.speechSynthesis.onvoiceschanged = () => start();
}
