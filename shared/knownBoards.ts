import type { Ats } from './ats';

/**
 * Boards that can't be found from a company's name: Workday boards (their addresses can't be
 * guessed) and boards behind a company's own careers site. Each one checked by hand; add more as
 * people run into them.
 */
export interface KnownBoard {
  name: string;
  /** The company's name squashed to letters and digits ("NVIDIA Corp" -> "nvidia"). */
  key: string;
  ats: Ats;
  board: string;
}

export const KNOWN_BOARDS: KnownBoard[] = [
  { name: 'NVIDIA', key: 'nvidia', ats: 'workday', board: 'nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite' },
  { name: 'Salesforce', key: 'salesforce', ats: 'workday', board: 'salesforce.wd12.myworkdayjobs.com/salesforce/External_Career_Site' },
  { name: 'Workday', key: 'workday', ats: 'workday', board: 'workday.wd5.myworkdayjobs.com/workday/Workday' },
  { name: 'DoorDash', key: 'doordash', ats: 'greenhouse', board: 'doordashusa' },
];

/** "NVIDIA Corp." -> "nvidia", "The Acme Co" -> "acme". */
export function companyKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w && !['the', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'co', 'company'].includes(w));
  return words.join('');
}

export const knownBoardsFor = (name: string) => KNOWN_BOARDS.filter((k) => k.key === companyKey(name));
