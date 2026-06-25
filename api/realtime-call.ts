import type { VercelRequest, VercelResponse } from '@vercel/node';

const REALTIME_MODEL = 'gpt-realtime-2';

type Persona = 'mom' | 'dad' | 'brother';

const PERSONA_VOICES: Record<Persona, string> = {
  mom: 'marin',
  dad: 'cedar',
  brother: 'marin',
};

const PERSONA_INSTRUCTIONS: Record<Persona, string> = {
  mom: `당신은 사용자와 전화하듯 대화하는 엄마입니다.
항상 한국어로만 말합니다.
따뜻하고 걱정 많은 자연스러운 반말을 씁니다.
답변은 보통 1~2문장으로 짧게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 엄마 역할을 유지합니다.
사용자가 짧게 답해도 자연스럽게 다음 말을 이어갑니다.`,

  dad: `당신은 사용자와 전화하듯 대화하는 아빠입니다.
항상 한국어로만 말합니다.
무뚝뚝하지만 든든하고 걱정이 묻어나는 반말을 씁니다.
답변은 보통 1~2문장으로 짧고 간결하게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 아빠 역할을 유지합니다.
사용자가 짧게 답해도 담백하게 다음 말을 이어갑니다.`,

  brother: `당신은 사용자와 전화하듯 대화하는 오빠입니다.
항상 한국어로만 말합니다.
장난스럽고 편하지만 사용자를 챙기는 보호자 같은 반말을 씁니다.
답변은 보통 1~2문장으로 짧게 말합니다.
"무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않습니다.
자신이 AI라는 사실을 먼저 말하지 않고 오빠 역할을 유지합니다.
사용자가 짧게 답해도 자연스럽게 대화를 이어갑니다.`,
};

function parsePersona(value: unknown): Persona {
  return value === 'dad' || value === 'brother' ? value : 'mom';
}

function buildRealtimeSession(persona: Persona) {
  return {
    type: 'realtime',
    model: REALTIME_MODEL,
    instructions: PERSONA_INSTRUCTIONS[persona],
    audio: {
      output: {
        voice: PERSONA_VOICES[persona],
      },
    },
  };
}

async function readBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return await new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const key = process.env.OPENAI_API_KEY;
  if (!key) { res.status(500).json({ error: 'OPENAI_API_KEY 미설정' }); return; }

  const sdp = await readBody(req);
  if (!sdp.trim()) { res.status(400).json({ error: 'SDP offer가 필요합니다.' }); return; }

  const persona = parsePersona(req.query.persona);
  const formData = new FormData();
  formData.set('sdp', sdp);
  formData.set('session', JSON.stringify(buildRealtimeSession(persona)));

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    });

    const answerSdp = await upstream.text();
    if (!upstream.ok) {
      res.status(upstream.status).send(answerSdp || 'OpenAI Realtime 연결 실패');
      return;
    }

    res.setHeader('Content-Type', 'application/sdp');
    res.status(200).send(answerSdp);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
