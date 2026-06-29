import type { SafetyFeatureConfig, SafetyFeatureId } from '../types';

const LABELS = {
  food: '\uCE74\uD398/\uC74C\uC2DD\uC810',
  convenience: '\uD3B8\uC758\uC810',
  police: '\uACBD\uCC30\uC11C',
  fire: '\uC18C\uBC29\uC11C',
  light: '\uAC00\uB85C\uB4F1/\uBCF4\uC548\uB4F1',
  childSafeHouse: '\uC548\uC804\uC9C0\uD0B4\uC774\uC9D1',
  medical: '\uC751\uAE09\uC758\uB8CC\uC2DC\uC124',
  toilet: '\uBE44\uC0C1\uBCA8',
};

export const SAFETY_FEATURES: SafetyFeatureConfig[] = [
  { id: 'cctv', label: 'CCTV', iconFile: 'custom-cctv.png', color: '#005CFF', weight: 3, nightWeight: 5 },
  { id: 'food', label: LABELS.food, iconFile: 'custom-food.png', color: '#FF6A00', weight: 3, nightWeight: 6 },
  { id: 'convenience', label: LABELS.convenience, iconFile: 'custom-convenience.png', color: '#00B84F', weight: 3, nightWeight: 5 },
  { id: 'police', label: LABELS.police, iconFile: 'custom-police.png', color: '#0B28B8', weight: 5, nightWeight: 8 },
  { id: 'fire', label: LABELS.fire, iconFile: 'custom-fire.png', color: '#E80000', weight: 4, nightWeight: 6 },
  { id: 'light', label: LABELS.light, color: '#F0DB4F', weight: 1, nightWeight: 4 },
  { id: 'childSafeHouse', label: LABELS.childSafeHouse, iconFile: 'custom-child-safe-house.png', color: '#FFC400', weight: 3, nightWeight: 4 },
  { id: 'medical', label: LABELS.medical, iconFile: 'custom-medical.png', color: '#E7198A', weight: 4, nightWeight: 6 },
  { id: 'toilet', label: LABELS.toilet, iconFile: 'custom-emergency-bell.png', color: '#7A3BEA', weight: 2, nightWeight: 3 },
];

export function getSafetyFeature(id: SafetyFeatureId): SafetyFeatureConfig {
  return SAFETY_FEATURES.find((feature) => feature.id === id) ?? SAFETY_FEATURES[0];
}

export function isSafetyFeatureId(value: string): value is SafetyFeatureId {
  return SAFETY_FEATURES.some((feature) => feature.id === value);
}
