/**
 * CompanionWrapper — AI 동행 로직(훅)을 한 번 초기화하고 displayMode에 따라 UI를 전환.
 *
 * 이 컴포넌트는 동행 세션이 끝나기 전까지 절대 unmount되지 않으므로
 * 풀스크린 ↔ 미니 전환 시에도 STT·Gemini·TTS·타이머가 끊김 없이 유지된다.
 * CompanionFullScreen과 CompanionMiniPanel은 순수 UI로, 훅 상태를 props로만 받는다.
 */
import { useAiCompanion } from '../hooks/useAiCompanion';
import type { CompanionMode } from '../hooks/useAiCompanion';
import CompanionFullScreen from './CompanionFullScreen';
import CompanionMiniPanel from './CompanionMiniPanel';

export type CompanionDisplayMode = 'mini' | 'fullscreen';

interface Props {
  mode: CompanionMode;
  displayMode: CompanionDisplayMode;
  onDisplayModeChange: (m: CompanionDisplayMode) => void;
  onEnd: () => void;
  onEmergency?: () => void;
  destination?: string;
  guardianPhones?: string[];
  currentLocation?: { lat: number; lng: number } | null;
  routeNodes?: { lat: number; lng: number }[];
  routeType?: 'safe' | 'fast';
}

export default function CompanionWrapper({
  mode, displayMode, onDisplayModeChange,
  onEnd, onEmergency, destination, guardianPhones, currentLocation, routeNodes, routeType,
}: Props) {
  const hookState = useAiCompanion({
    mode, onEnd, onEmergency, destination, guardianPhones, currentLocation, routeNodes, routeType,
  });

  const commonProps = { ...hookState, mode, destination, routeType };

  return displayMode === 'fullscreen' ? (
    <CompanionFullScreen
      {...commonProps}
      onMinimize={() => onDisplayModeChange('mini')}
    />
  ) : (
    <CompanionMiniPanel
      {...commonProps}
      onExpand={() => onDisplayModeChange('fullscreen')}
    />
  );
}
