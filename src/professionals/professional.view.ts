import type { Professional } from '@prisma/client';

/**
 * The two shapes a professional is ever serialized into, and the rules that
 * separate them.
 *
 * Keeping both in one file is the point: the difference between "what I see
 * about myself" and "what a stranger sees about me" is a privacy decision, and
 * a privacy decision spread across two services is one that drifts. Anything
 * added to the model gets added here first, which forces the question "does
 * this go in the public one?" to be answered rather than defaulted.
 */

/** One portfolio tile. Deliberately the simplest shape that can be reordered. */
export interface ProfilePhoto {
  url: string;
  label?: string;
}

/** What the account holder sees about themselves. Never the password hash. */
export interface PublicProfessional {
  id: string;
  name: string;
  phone: string;
  email: string;
  specialtyKeys: string[];
  areaKeys: string[];
  experienceYears: number | null;
  about: string;
  avatarUrl: string;
  photos: ProfilePhoto[];
  cvUrl: string;
  publicProfile: boolean;
  showContact: boolean;
  locale: string;
}

/**
 * What anyone else sees, at the profile's public URL.
 *
 * Note what is NOT here by construction rather than by filter: there is no
 * `email` field at all, and `phone` is a nullable field that only survives when
 * the account has said so. A view type that cannot hold a value cannot leak it
 * through a spread, a log line or a future endpoint that reuses the shape —
 * which is a stronger guarantee than remembering to delete a key.
 */
export interface PublicProfileView {
  id: string;
  name: string;
  specialtyKeys: string[];
  areaKeys: string[];
  experienceYears: number | null;
  about: string;
  avatarUrl: string;
  photos: ProfilePhoto[];
  /** Present only when the account chose to publish it. */
  phone: string | null;
  /** Whether there is a way to reach them from the page at all. */
  contactVisible: boolean;
  memberSince: string;
}

/**
 * Read the `photos` JSON column defensively.
 *
 * It is a JSON column, so the database's guarantee stops at "valid JSON" — a
 * hand-edited row, a half-finished migration or an older shape all arrive here
 * as something that is not an array of `{ url }`. Everything that is not a
 * usable tile is dropped rather than rendered as an empty box.
 */
export function readPhotos(value: unknown): ProfilePhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ProfilePhoto[] => {
    if (!raw || typeof raw !== 'object') return [];
    const url = (raw as { url?: unknown }).url;
    if (typeof url !== 'string' || !url) return [];
    const label = (raw as { label?: unknown }).label;
    return [{ url, ...(typeof label === 'string' && label ? { label } : {}) }];
  });
}

export function toPublicProfessional(p: Professional): PublicProfessional {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email ?? '',
    specialtyKeys: p.specialtyKeys,
    areaKeys: p.areaKeys,
    experienceYears: p.experienceYears,
    about: p.about,
    avatarUrl: p.avatarUrl,
    photos: readPhotos(p.photos),
    cvUrl: p.cvUrl,
    publicProfile: p.publicProfile,
    showContact: p.showContact,
    locale: p.locale,
  };
}

export function toPublicProfileView(p: Professional): PublicProfileView {
  return {
    id: p.id,
    name: p.name,
    specialtyKeys: p.specialtyKeys,
    areaKeys: p.areaKeys,
    experienceYears: p.experienceYears,
    about: p.about,
    avatarUrl: p.avatarUrl,
    photos: readPhotos(p.photos),
    // The single place the contact rule is applied.
    phone: p.showContact ? p.phone : null,
    contactVisible: p.showContact,
    memberSince: p.createdAt.toISOString(),
  };
}
