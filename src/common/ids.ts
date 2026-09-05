import { v7 as uuidv7 } from 'uuid';

/**
 * Application-generated primary key. UUIDv7 is time-ordered, so rows insert in
 * roughly sequential order — keeping B-tree indexes compact at high write
 * volume — while remaining globally unique and non-enumerable.
 */
export function newId(): string {
  return uuidv7();
}

/**
 * A one-off identifier for a refresh token (`jti`).
 *
 * Load-bearing, not decoration. A refresh JWT's payload is otherwise just
 * `{ sub, type, iat, exp }`, and `iat`/`exp` have SECOND resolution — so two
 * tokens minted for the same principal within the same second are byte
 * identical, hash identically, and the second `create` violates the unique
 * index on tokenHash.
 *
 * That is not hypothetical: registering a professional signs them in and the
 * very next action can be another sign-in, which failed with a 409 reading "A
 * record with these values already exists" — a message about a database
 * constraint shown to someone typing a password. All three realms sign refresh
 * tokens this way, so all three take this.
 */
export function newTokenId(): string {
  return uuidv7();
}
