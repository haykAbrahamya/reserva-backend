import type { PrismaService } from '@/prisma/prisma.service';
import { LeadsService, contactKey, instagramUsername } from './leads.service';

function setup(session: { isBot: boolean; isInternal: boolean } | null = { isBot: false, isInternal: false }) {
  const prisma = {
    siteSession: { findUnique: jest.fn(async () => session) },
    $executeRaw: jest.fn(async () => 1),
    lead: {
      findFirst: jest.fn(async (): Promise<{ id: string } | null> => null),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      upsert: jest.fn(async () => ({})),
    },
  };
  const service = new LeadsService(prisma as unknown as PrismaService);
  const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  return { prisma, service, warn };
}

const at = new Date('2026-10-15T15:00:00Z');
const signed = (contact: string, tool = 'priceList') => ({ contact, tool, at });

describe('LeadsService — capture', () => {
  it('keys a contact line by its words, not its spacing or case', () => {
    expect(contactKey('  Mane   +374 91 123456 ')).toBe('mane +374 91 123456');
    expect(contactKey('@Mane.Nails')).toBe('@mane.nails');
  });

  it('reads an Instagram username from @handles and profile links', () => {
    expect(instagramUsername('@Mane.Nails')).toBe('mane.nails');
    expect(instagramUsername('https://www.instagram.com/mane.nails/')).toBe('mane.nails');
    expect(instagramUsername('  ')).toBeNull();
  });

  it('makes one lead per signed tools export — keyed by the contact line', async () => {
    const { prisma, service, warn } = setup();
    await service.fromToolExports('sid-1', [signed('Mane +374 91 123456'), signed('@lilit_nails', 'freeSlots')]);
    expect(warn).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    const [, , key] = prisma.$executeRaw.mock.calls[0] as unknown as [unknown, string, string];
    expect(key).toBe('mane +374 91 123456');
  });

  it('never makes a lead of staff testing, a bot, or the examples’ own contact', async () => {
    for (const session of [{ isBot: true, isInternal: false }, { isBot: false, isInternal: true }, null]) {
      const { prisma, service } = setup(session);
      await service.fromToolExports('sid-1', [signed('Mane +374 91 123456')]);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    }
    const { prisma, service } = setup();
    await service.fromToolExports('sid-1', [signed('  @Anna.Beauty ')]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('moves the lead of an earlier sign-up with the same email to the new one, notes and all', async () => {
    const { prisma, service } = setup();
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-1' });
    const pending = {
      id: 'pending-2', adminName: 'Ruzanna', companyName: 'Ruzanna', companyType: 'Մատնահարդար',
      slug: 'ruzanna', adminPhone: '+37443077811', adminEmail: 'ruzanna@example.com',
    };
    await service.fromSignup(pending);
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: expect.objectContaining({ sourceRef: 'pending-2', context: 'Մատնահարդար · /ruzanna' }),
    });
  });

  it('turns an activated sign-up’s lead into a partner', async () => {
    const { prisma, service } = setup();
    await service.signupActivated('pending-2', 'partner-9');
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { source: 'signup', sourceRef: 'pending-2' },
      data: expect.objectContaining({ status: 'partner', partnerId: 'partner-9' }),
    });
  });

  it('never throws into the action it rides on', async () => {
    const { prisma, service, warn } = setup();
    prisma.lead.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(service.fromDemoRequest({ id: 'd1', name: 'Anna', company: null, phone: '+37491000000', email: null, notes: null }))
      .resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
