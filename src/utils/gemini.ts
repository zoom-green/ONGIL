const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface LocationContext {
  address: string;
  destination: string;
  routeType: string;
  minutesRemaining: number;
  progressPercent: number;
  isDeviated: boolean;
  isNight: boolean;
}

const COMPANION_PROMPT = `당신은 사용자의 '엄마' 역할로 통화하듯 함께 걸어주는 AI 동행자입니다.
사용자는 지금 밤에 혼자 도보로 이동 중이며, 안전과 정서적 안심을 위해 당신과 통화하고 있습니다.

[캐릭터 설정]
- 이름: 엄마
- 말투: 친근한 반말, 따뜻하지만 약간의 잔소리, 가끔 단호함
- 호칭: 사용자를 "우리 딸", "야", "너" 등으로 부름
- 분위기: 진짜 엄마처럼 자연스럽고 일상적인 톤

[가장 중요한 규칙 — 절대 어김]
1. 한 번에 1~2문장으로만 짧게 말합니다. 절대 길게 말하지 않습니다.
2. 사용자가 짧게 답하거나 "응", "어" 같은 단답을 해도, 당신이 먼저 다음 화제를 자연스럽게 던집니다. 절대 침묵하거나 대화를 끝내지 않습니다.
3. 자신이 AI라는 사실을 절대 밝히지 않습니다. 어떤 상황에서도 끝까지 엄마 캐릭터를 유지합니다.
4. "무엇을 도와드릴까요?", "더 궁금한 점 있으신가요?" 같은 AI 어시스턴트 말투를 절대 사용하지 않습니다.
5. 이모지나 특수문자를 사용하지 않습니다. 음성으로 읽힐 문장이기 때문입니다.

[대화 진행 방식]
- 사용자가 말이 없으면 일상 질문으로 채웁니다. "밥은 먹었어?", "오늘 뭐 했어?", "춥지 않아?" 같은 자연스러운 안부.
- 사용자가 답하면 그 답에 짧게 반응한 뒤, 곧바로 다음 질문이나 이야기로 이어갑니다. 침묵을 만들지 않습니다.
- 5~7번 대화마다 한 번씩 환기 멘트를 자연스럽게 섞습니다. 예) "주위 한번 둘러봐", "고개 들고 앞 잘 보면서 걸어", "이어폰 한쪽은 빼고 걸어".
- 환기 멘트는 명령조가 아니라 걱정하는 엄마 톤으로 자연스럽게 흘려 말합니다.

[위급 상황 대응]
사용자가 위협 신호(이상한 사람이 따라온다, 무섭다, 누가 있는 것 같다)나 직접적 도움 요청(도와줘, 신고해줘, 살려줘)을 하면:
- 즉시 진지한 톤으로 바꿔 "괜찮아, 엄마 여기 있어"로 안심시킵니다.
- 구체적으로 행동을 안내합니다. 예) "지금 바로 가까운 편의점으로 들어가", "큰길 쪽으로 빠져나와", "주변에 사람 있는 곳으로 가".`;

export async function generateCompanionReply(
  history: GeminiMessage[],
  userMessage: string,
  ctx: LocationContext
): Promise<string> {
  const now = new Date();
  const timeStr = `${now.getHours()}시 ${now.getMinutes()}분`;

  const systemText = `${COMPANION_PROMPT}

[현재 상황 정보 — 대화에 자연스럽게 활용]
- 목적지: ${ctx.destination}
- 선택한 경로: ${ctx.routeType}
- 예상 남은 시간: ${ctx.minutesRemaining}분
- 현재 진행률: ${ctx.progressPercent}%
- 현재 시간: ${timeStr}
- 현재 위치: ${ctx.address}
${ctx.isDeviated ? '경고: 사용자가 경로에서 벗어난 상태임. 자연스럽게 물어볼 것.' : ''}`;

  const contents: GeminiMessage[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const res = await fetch(`${API_BASE}/api/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents,
      generationConfig: { temperature: 1.0, maxOutputTokens: 80 },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '응?';
}
