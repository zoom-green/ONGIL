import { Capacitor } from '@capacitor/core';

declare module '@byteowls/capacitor-sms' {
  interface SmsPlugin {
    send(options: { numbers: string[]; text: string }): Promise<void>;
  }
}

async function getSmsPlugin() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const { SmsManager } = await import('@byteowls/capacitor-sms');
    return SmsManager;
  } catch {
    return null;
  }
}

export async function sendGuardianSMSAll(phones: string[], message: string): Promise<void> {
  for (const phone of phones) {
    if (phone.trim()) await sendGuardianSMS(phone, message);
  }
}

export async function sendGuardianSMS(phone: string, message: string): Promise<boolean> {
  const sms = await getSmsPlugin();
  if (!sms) {
    // 웹 환경 — SMS 전송 불가
    console.warn('[SMS] 네이티브 앱에서만 SMS 전송 가능');
    return false;
  }
  try {
    await sms.send({ numbers: [phone.replace(/[^0-9]/g, '')], text: message });
    return true;
  } catch (e) {
    console.error('[SMS] 전송 실패:', e);
    return false;
  }
}

export function buildGuardianMessage(
  type: 'emergency' | 'location_update' | 'arrived',
  location: { lat: number; lng: number } | null,
  destination?: string
): string {
  const locText = location
    ? `https://maps.google.com/?q=${location.lat.toFixed(5)},${location.lng.toFixed(5)}`
    : '위치 확인 중';

  switch (type) {
    case 'emergency':
      return `[온길 긴급] 사용자가 위험 상황을 신고했습니다.\n현재 위치: ${locText}\n즉시 연락하거나 112에 신고해주세요.`;
    case 'location_update':
      return `[온길] 안전 귀가 중 위치 업데이트\n${destination ? `목적지: ${destination}\n` : ''}현재 위치: ${locText}`;
    case 'arrived':
      return `[온길] 안전하게 도착했습니다! ${destination ? `(${destination})` : ''}\n걱정 마세요.`;
  }
}
