import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

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
}
