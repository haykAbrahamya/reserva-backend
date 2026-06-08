import { v7 as uuidv7 } from 'uuid';

/**
 * Application-generated primary key. UUIDv7 is time-ordered, so rows insert in
 * roughly sequential order — keeping B-tree indexes compact at high write
 * volume — while remaining globally unique and non-enumerable.
 */
export function newId(): string {
  return uuidv7();
}
