import { ErrorCode } from '@/common/errors/error-codes';
import type { UpdatePartnerDto } from './dto/partner.dto';
import { PartnersService } from './partners.service';

/** Stops `update` at the write, so a test can tell "validation passed" from "refused". */
const REACHED_WRITE = 'reached the write';

/**
 * A stand-in for PrismaService holding one partner with `currentSlug`. Only the
 * calls `update` makes before writing are implemented; the transaction throws a
 * sentinel, so reaching it means every check in front of it let the update by.
 */
function serviceWithPartner(currentSlug: string | null) {
  const prisma = {
    partner: {
      // assertExists, then the "is this slug taken by someone else" check.
      findFirst: jest.fn().mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce(null),
      findUnique: jest.fn().mockResolvedValue({ slug: currentSlug }),
    },
    $transaction: jest.fn().mockRejectedValue(new Error(REACHED_WRITE)),
  };
  return new PartnersService(prisma as never, {} as never, {} as never, {} as never);
}

const update = (service: PartnersService, dto: Partial<UpdatePartnerDto>) =>
  service.update('p1', dto as UpdatePartnerDto);

describe('PartnersService.update — reserved handles', () => {
  it("refuses to move a partner onto one of Reserva's own addresses", async () => {
    await expect(update(serviceWithPartner('anna-beauty'), { slug: 'tools' })).rejects.toMatchObject({
      code: ErrorCode.SLUG_TAKEN,
    });
  });

  it('lets a partner that already holds a now-reserved handle keep saving', async () => {
    // A slug taken before it was reserved must never lock its owner out.
    await expect(update(serviceWithPartner('tools'), { slug: 'tools', name: 'Renamed' })).rejects.toThrow(
      REACHED_WRITE,
    );
  });

  it('allows an ordinary new handle', async () => {
    await expect(update(serviceWithPartner('anna-beauty'), { slug: 'anna-studio' })).rejects.toThrow(REACHED_WRITE);
  });

  it('does not look at handles at all when the slug is not being changed', async () => {
    await expect(update(serviceWithPartner('anna-beauty'), { name: 'Anna Studio' })).rejects.toThrow(REACHED_WRITE);
  });
});
