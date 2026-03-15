import { randomBytes } from 'crypto';

export function generateSlug(title: string) {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rand = randomBytes(3).toString('hex');
  return `${clean}-${rand}`;
}
