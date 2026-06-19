import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import https from 'https';

const app = express();
const PORT = 3001;

app.use(cors({ origin: ['http://localhost:5173', 'capacitor://localhost', 'ionic://localhost'] }));
app.use(express.json({ limit: '2mb' }));

// ─── 카카오 운영시간 프록시 ───────────────────────────────────────────
app.get('/api/hours', (req, res) => {
  const placeId = req.query.placeId as string;
  if (!placeId) { res.status(400).json({ error: 'placeId required' }); return; }

  const url = `https://place.map.kakao.com/main/v/${placeId}`;
  https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://map.kakao.com/',
    },
  }, (kakaoRes) => {
    let body = '';
    kakaoRes.on('data', (chunk) => { body += chunk; });
    kakaoRes.on('end', () => {
      try { res.json({ openHour: JSON.parse(body)?.basicInfo?.openHour ?? null }); }
      catch { res.json({ openHour: null }); }
    });
  }).on('error', () => res.json({ openHour: null }));
});

// ─── Gemini 프록시 ────────────────────────────────────────────────────
app.post('/api/gemini', async (req, res) => {
  const key = process.env.GEMINI_KEY;
  if (!key) { res.status(500).json({ error: 'GEMINI_KEY 미설정' }); return; }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) }
    );
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── ElevenLabs TTS 프록시 ────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  const key = process.env.ELEVENLABS_KEY;
  if (!key) { res.status(500).json({ error: 'ELEVENLABS_KEY 미설정' }); return; }

  const { voiceId, text, voice_settings } = req.body as {
    voiceId: string; text: string; voice_settings?: object;
  };
  if (!voiceId || !text) { res.status(400).json({ error: 'voiceId, text 필수' }); return; }

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: voice_settings ?? { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      res.status(upstream.status).json(err);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(buffer);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`[온길 서버] http://localhost:${PORT}`));
