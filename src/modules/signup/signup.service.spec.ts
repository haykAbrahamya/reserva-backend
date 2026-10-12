import { SignupService } from './signup.service';

/** A stand-in PrismaService where no partner exists yet — every handle is free in the database. */
function serviceWithNoPartners() {
  const findUnique = jest.fn().mockResolvedValue(null);
  const prisma = { partner: { findUnique } };
  const service = new SignupService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, findUnique };
}

describe('SignupService.slugAvailable', () => {
  it("reports a reserved handle as unavailable even though no partner has it", async () => {
    const { service, findUnique } = serviceWithNoPartners();
    await expect(service.slugAvailable('tools')).resolves.toBe(false);
    // Decided from the list alone — no reason to ask the database.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('normalizes before checking, the way the form sends it', async () => {
    const { service } = serviceWithNoPartners();
    await expect(service.slugAvailable('  Tools ')).resolves.toBe(false);
  });

  it('reports an ordinary free handle as available', async () => {
    const { service } = serviceWithNoPartners();
    await expect(service.slugAvailable('anna-beauty')).resolves.toBe(true);
  });
});
