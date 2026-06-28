import type { SafetyFeatureConfig, SafetyFeatureId } from '../types';

const LABELS = {
  food: '\uCE74\uD398/\uC74C\uC2DD\uC810',
  convenience: '\uD3B8\uC758\uC810',
  police: '\uACBD\uCC30\uC11C/\uC9C0\uAD6C\uB300',
  fire: '\uC18C\uBC29\uC11C',
  light: '\uAC00\uB85C\uB4F1/\uBCF4\uC548\uB4F1',
  childSafeHouse: '\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
  medical: '\uC751\uAE09\uC758\uB8CC\uC2DC\uC124',
  toilet: '\uBE44\uC0C1\uBCA8 \uACF5\uC911\uD654\uC7A5\uC2E4',
};

export const SAFETY_FEATURES: SafetyFeatureConfig[] = [
  { id: 'cctv', label: 'CCTV', iconFile: 'custom-cctv.png', color: '#005CFF', weight: 3, nightWeight: 5 },
  { id: 'food', label: LABELS.food, iconFile: 'custom-food.png', color: '#FF6A00', weight: 3, nightWeight: 6 },
  { id: 'convenience', label: LABELS.convenience, iconFile: 'custom-convenience.png', color: '#00B84F', weight: 3, nightWeight: 5 },
  { id: 'police', label: LABELS.police, iconFile: 'police.png', color: '#4F6FE5', weight: 5, nightWeight: 8 },
  { id: 'fire', label: LABELS.fire, iconFile: 'custom-fire.png', color: '#E80000', weight: 4, nightWeight: 6 },
  { id: 'light', label: LABELS.light, color: '#F0DB4F', weight: 1, nightWeight: 4 },
  { id: 'childSafeHouse', label: LABELS.childSafeHouse, color: '#61A874', weight: 3, nightWeight: 4 },
  { id: 'medical', label: LABELS.medical, color: '#CF4F78', weight: 4, nightWeight: 6 },
  { id: 'toilet', label: LABELS.toilet, color: '#9A65DE', weight: 2, nightWeight: 3 },
];

export const DEFAULT_SELECTED_FEATURES: SafetyFeatureId[] = [
  'cctv',
  'food',
  'convenience',
  'police',
  'fire',
  'light',
];

export function getSafetyFeature(id: SafetyFeatureId): SafetyFeatureConfig {
  return SAFETY_FEATURES.find((feature) => feature.id === id) ?? SAFETY_FEATURES[0];
}

export function isSafetyFeatureId(value: string): value is SafetyFeatureId {
  return SAFETY_FEATURES.some((feature) => feature.id === value);
}
