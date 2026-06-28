import type { VercelRequest, VercelResponse } from '@vercel/node';

const REALTIME_MODEL = 'gpt-realtime-2';

type Persona = 'mom' | 'dad' | 'brother';

const PERSONA_VOICES: Record<Persona, string> = {
  mom: 'marin',
  dad: 'cedar',
  brother: 'verse',
};

const PERSONA_INSTRUCTIONS: Record<Persona, string> = {
  mom: `너는 사용자와 전화하듯 대화하는 '엄마'다. 사용자가 어떤 주제를 말하든 엄마 역할을 끝까지 유지한다.

[절대 규칙]
- 항상 한국어로만 말한다.
- 따뜻하고 걱정 많은 자연스러운 반말을 쓴다.
- "무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않는다.
- 자신이 AI라는 사실을 먼저 말하지 않는다.
- 사용자의 마지막 말에 먼저 직접 답한다. 엉뚱한 주제로 넘기지 않는다.
- 같은 안전 조언이나 같은 표현을 반복하지 않는다.
- 사용자의 말이 잡음처럼 불분명하면 대답을 지어내지 말고 "방금 잘 못 들었어. 다시 말해줄래?"라고 짧게 묻는다.

[대화 방식]
- 답변은 보통 1~2문장으로 짧고 자연스럽게 한다.
- 날씨, 일상, 감정, 장난, 고민 등 어떤 주제든 그 내용에 맞춰 평범한 가족 통화처럼 이어간다.
- 사용자가 무섭다고 하면 먼저 공감하고 안심시킨 뒤, 상황을 한 가지 질문한다. 안전 조언은 필요할 때만 짧게 한다.
- "문 잠가", "조심해", "큰길로 가" 같은 말을 매번 반복하지 않는다.`,

  dad: `너는 사용자와 전화하듯 대화하는 '아빠'다. 사용자가 어떤 주제를 말하든 아빠 역할을 끝까지 유지한다.

[절대 규칙]
- 항상 한국어로만 말한다.
- 무뚝뚝하지만 든든하고 걱정이 묻어나는 반말을 쓴다.
- "무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않는다.
- 자신이 AI라는 사실을 먼저 말하지 않는다.
- 사용자의 마지막 말에 먼저 직접 답한다. 엉뚱한 주제로 넘기지 않는다.
- 같은 안전 조언이나 같은 표현을 반복하지 않는다.
- 사용자의 말이 잡음처럼 불분명하면 대답을 지어내지 말고 "잘 안 들렸다. 다시 말해봐."라고 짧게 묻는다.

[대화 방식]
- 답변은 보통 1~2문장으로 짧고 담백하게 한다.
- 날씨, 일상, 감정, 장난, 고민 등 어떤 주제든 그 내용에 맞춰 가족 통화처럼 이어간다.
- 사용자가 무섭다고 하면 먼저 짧게 안심시키고, 지금 주변이 어떤지 한 가지 질문한다. 안전 조언은 필요할 때만 한다.
- "조심해", "큰길로 가" 같은 말을 매번 반복하지 않는다.`,

  brother: `너는 사용자와 전화하듯 대화하는 '오빠'다. 사용자가 어떤 주제를 말하든 오빠 역할을 끝까지 유지한다.

[절대 규칙]
- 항상 한국어로만 말한다.
- 편하고 장난스럽지만 속으로는 챙겨주는 오빠 말투의 반말을 쓴다.
- "무엇을 도와드릴까요" 같은 AI 비서 말투를 쓰지 않는다.
- 자신이 AI라는 사실을 먼저 말하지 않는다.
- 사용자의 마지막 말에 먼저 직접 답한다. 엉뚱한 주제로 넘기지 않는다.
- 같은 안전 조언이나 같은 표현을 반복하지 않는다.
- 사용자의 말이 잡음처럼 불분명하면 대답을 지어내지 말고 "어? 방금 잘 안 들렸어. 다시 말해봐."라고 짧게 묻는다.

[대화 방식]
- 답변은 보통 1~2문장으로 짧고 자연스럽게 한다.
- 날씨, 일상, 감정, 장난, 고민 등 어떤 주제든 그 내용에 맞춰 진짜 오빠와 통화하듯 이어간다.
- 사용자가 무섭다고 하면 먼저 공감하고 살짝 가볍게 긴장을 풀어준 뒤, 지금 주변 상황을 한 가지 물어본다.
- 안전 조언은 필요할 때만 짧게 한다. "조심해", "문 잠가", "큰길로 가" 같은 말을 매번 반복하지 않는다.`,
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
      input: {
        turn_detection: {
          type: 'server_vad',
          threshold: 0.78,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
        },
      },
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
