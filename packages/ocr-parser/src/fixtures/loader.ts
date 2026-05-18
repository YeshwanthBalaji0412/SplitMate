import { readFileSync } from 'fs';
import { join } from 'path';
import type { RawLine } from '../types';

export function loadFixture(filename: string): RawLine[] {
  const filepath = join(__dirname, filename);
  const text = readFileSync(filepath, 'utf-8');
  return text
    .split('\n')
    .map((line, i) => ({ text: line.trimEnd(), position: i }))
    .filter((line) => line.text.length > 0);
}
