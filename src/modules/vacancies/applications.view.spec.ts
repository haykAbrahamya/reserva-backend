import { toApplicationView, type ApplicationRow } from './applications.service';

/**
 * The privacy line between an application and a profile.
 *
 * Worth a test rather than a comment: an application carries what the applicant
 * TYPED into a salon's form, and their profile is a separate thing they may
 * never have published. The rule is one boolean deep in a mapper, and the
 * failure mode is silent — a salon quietly gets a link to a page its owner kept
 * closed, and nobody notices until the owner does.
 */

const row = (professional: ApplicationRow['professional']): ApplicationRow => ({
  id: 'app-1',
  name: 'Ani Hakobyan',
  phone: '+37455100001',
  email: 'ani@example.com',
  note: 'I would like to apply.',
  locale: 'hy',
  source: 'board',
  status: 'new',
  seenAt: null,
  createdAt: new Date('2026-09-06T10:00:00Z'),
  professional,
});

describe('toApplicationView', () => {
  it('links the profile when the applicant published one', () => {
    const view = toApplicationView(
      row({ id: 'pro-1', publicProfile: true, avatarUrl: '/uploads/pro/pro-1/av-x.webp' }),
    );
    expect(view.account).toEqual({
      hasAccount: true,
      profileId: 'pro-1',
      avatarUrl: '/uploads/pro/pro-1/av-x.webp',
    });
  });

  it('withholds the profile id AND the avatar when they did not', () => {
    const view = toApplicationView(
      row({ id: 'pro-2', publicProfile: false, avatarUrl: '/uploads/pro/pro-2/av-y.webp' }),
    );
    // Still says there is an account — that is useful triage — but nothing
    // from the unpublished page survives.
    expect(view.account).toEqual({ hasAccount: true, profileId: null, avatarUrl: '' });
  });

  it('reports an anonymous application as having no account', () => {
    const view = toApplicationView(row(null));
    expect(view.account).toEqual({ hasAccount: false, profileId: null, avatarUrl: '' });
  });

  it('never passes the raw professional relation through', () => {
    const view = toApplicationView(
      row({ id: 'pro-3', publicProfile: false, avatarUrl: '/uploads/pro/pro-3/av-z.webp' }),
    );
    // The guard that matters: a future `...row` spread must not smuggle the
    // relation — including `publicProfile` and an unpublished avatar — onto the
    // wire.
    expect('professional' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('av-z.webp');
    expect(JSON.stringify(view)).not.toContain('publicProfile');
  });

  it('keeps everything the applicant typed', () => {
    const view = toApplicationView(row(null));
    expect(view).toMatchObject({
      id: 'app-1',
      name: 'Ani Hakobyan',
      phone: '+37455100001',
      email: 'ani@example.com',
      note: 'I would like to apply.',
      status: 'new',
    });
  });
});
