import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'index.html'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css']);
const suspicious = [
  '寃쎈줈',
  '蹂댄샇',
  '臾몄옄',
  '吏',
  '紐⑹',
  '湲닿',
  '諛쒖',
  '遺덈',
  '源뚯',
  '?꾩',
  '?덉',
  '?듯',
  '?좉',
  '?ㅼ',
  '?뱧',
  '?뮠',
  '?슚',
  '�',
];

function walk(target) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    return readdirSync(target).flatMap((name) => walk(join(target, name)));
  }
  const ext = target.slice(target.lastIndexOf('.'));
  return extensions.has(ext) ? [target] : [];
}

const offenders = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('{/*') || trimmed.startsWith('*')) return;
      if (line.includes('ON:吉 온길')) return;
      if (suspicious.some((token) => line.includes(token))) {
        offenders.push(`${file}:${index + 1}: ${trimmed}`);
      }
    });
  }
}

if (offenders.length > 0) {
  console.error('Possible mojibake text found. Save files as UTF-8 and fix these lines:');
  console.error(offenders.join('\n'));
  process.exit(1);
}
