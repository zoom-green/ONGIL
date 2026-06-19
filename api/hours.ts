import https from 'https';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const placeId = req.query.placeId as string | undefined;
  if (!placeId) {
    res.status(400).json({ error: 'placeId required' });
    return;
  }

  const url = `https://place.map.kakao.com/main/v/${placeId}`;
  https.get(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://map.kakao.com/',
      },
    },
    (kakaoRes) => {
      let body = '';
      kakaoRes.on('data', (chunk) => { body += chunk; });
      kakaoRes.on('end', () => {
        try {
          const data = JSON.parse(body);
          res.status(200).json({ openHour: data?.basicInfo?.openHour ?? null });
        } catch {
          res.status(200).json({ openHour: null });
        }
      });
    }
  ).on('error', () => res.status(200).json({ openHour: null }));
}
