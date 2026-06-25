export type Persona = 'mom' | 'dad' | 'brother';

export const PERSONA_LABELS: Record<Persona, string> = {
  mom: '엄마',
  dad: '아빠',
  brother: '오빠',
};

export const PERSONA_EMOJI: Record<Persona, string> = {
  mom: '👩',
  dad: '👨',
  brother: '🧑',
};

export const PERSONA_DESCRIPTIONS: Record<Persona, string> = {
  mom: '따뜻하고 걱정 많은 반말',
  dad: '무뚝뚝하지만 든든한 반말',
  brother: '장난스럽지만 보호자 같은 반말',
};
