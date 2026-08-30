import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import type { PendingRegistration, User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AuthService, type AuthResult } from '@/auth/auth.service';
import { MailService } from '@/mail/mail.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import type { SignupDto } from './dto/signup.dto';
import { ProductsService } from '@/modules/products/products.service';

const TOKEN_TTL_HOURS = 24;

/** Default weekly hours for an auto-provisioned solo specialist (Mon–Sat 10–19). */
const SOLO_DEFAULT_SCHEDULE = {
  mon: { enabled: true, start: '10:00', end: '19:00' },
  tue: { enabled: true, start: '10:00', end: '19:00' },
  wed: { enabled: true, start: '10:00', end: '19:00' },
  thu: { enabled: true, start: '10:00', end: '19:00' },
  fri: { enabled: true, start: '10:00', end: '19:00' },
  sat: { enabled: true, start: '10:00', end: '19:00' },
  sun: { enabled: false, start: '10:00', end: '19:00' },
};

/** Self-serve partner signup: pending row → emailed magic link → activation. */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly products: ProductsService,
  ) {}

  /**
   * Start a signup: validate uniqueness, store a PendingRegistration with a
   * hashed token, and email the activation magic link. Returns nothing
   * sensitive — just acknowledges so we don't leak whether an email exists.
   */
  async start(dto: SignupDto): Promise<{ email: string }> {
    // Slug is OPTIONAL — no auto-derive. Empty string = "no slug yet".
    const slug = dto.slug ? dto.slug.toLowerCase() : '';
    const email = dto.adminEmail.toLowerCase();
    const phone = normalizePhone(dto.adminPhone);

    // Intent is validated against the catalog, never trusted from the client:
    // an anonymous caller must not be able to grant itself a curated product.
    const product = dto.product ?? 'bookings';
    await this.products.assertSelfServe(product);

    // Validate duplicates UP FRONT so the form shows the error (not at activation).
    if (slug) await this.assertSlugFree(slug);
    await this.assertEmailFree(email);
    await this.assertPhoneFree(phone);

    // Raw token goes in the email; only its hash is stored.
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600_000);

    // Clear any prior unconsumed signup for this email (re-signup overwrites).
    await this.prisma.pendingRegistration.deleteMany({
      where: { adminEmail: email, consumedAt: null },
    });

    await this.prisma.pendingRegistration.create({
      data: {
        id: newId(),
        tokenHash,
        companyName: dto.companyName,
        companyType: dto.companyType,
        kind: dto.kind ?? 'salon',
        product,
        slug,
        accent: dto.accent,
        adminName: dto.adminName,
        adminEmail: email,
        adminPhone: phone,
        passwordHash: await this.passwords.hash(dto.password),
        expiresAt,
      },
    });

    const base = this.config.get<string>('BACKOFFICE_URL') || 'https://backoffice.reserva.am';
    const link = `${base}/activate?token=${rawToken}`;
    await this.mail.sendActivation(email, {
      name: dto.adminName,
      company: dto.companyName,
      link,
    });

    return { email };
  }

  /**
   * Activate via the magic-link token: create the Partner + first admin User
   * atomically, consume the pending row, and return a session (auto-login).
   */
  async activate(rawToken: string): Promise<AuthResult> {
    const tokenHash = hashToken(rawToken);
    const pending = await this.prisma.pendingRegistration.findUnique({ where: { tokenHash } });

    if (!pending || pending.consumedAt || pending.expiresAt < new Date()) {
      throw new AppException(
        ErrorCode.TOKEN_INVALID,
        'This activation link is invalid or has expired. Please sign up again.',
        400,
      );
    }

    const adminUser = await this.provisionFromPending(pending);
    // Auto-login: issue a session for the freshly created admin.
    return this.auth.loginTrustedUser(adminUser);
  }

  /**
   * Manually activate a pending signup by id — used by platform staff from the
   * internal console to provision an account without the partner clicking the
   * email link (e.g. they never received it). Unlike {@link activate}, this does
   * NOT require the raw token, does NOT auto-login (the operator isn't the
   * partner), and ignores expiry (staff can activate a lapsed signup). Returns
   * the created partner id + admin email.
   */
  async activateById(pendingId: string): Promise<{ partnerId: string; adminEmail: string }> {
    const pending = await this.prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending || pending.consumedAt) {
      throw AppException.notFound('Pending registration not found');
    }
    const adminUser = await this.provisionFromPending(pending);
    return { partnerId: adminUser.partnerId, adminEmail: adminUser.email };
  }

  /**
   * Shared provisioning: create the Partner + first admin User atomically (and,
   * for `single` partners, the auto-provisioned location + specialist), then
   * consume the pending row. Re-checks slug/email/phone uniqueness first, since
   * they could have been taken since signup. Returns the created admin User.
   */
  private async provisionFromPending(
    pending: PendingRegistration,
  ): Promise<User> {
    // Re-check uniqueness at activation (someone could have taken slug/email/
    // phone in the meantime). If taken, surface a clear error.
    const slug = pending.slug || null; // empty string → no slug
    if (slug) await this.assertSlugFree(slug);
    await this.assertEmailFree(pending.adminEmail);
    await this.assertPhoneFree(pending.adminPhone);

    const partnerId = newId();
    return this.prisma.$transaction(async (tx) => {
      await tx.partner.create({
        data: {
          id: partnerId,
          slug, // null when the signup didn't choose one
          name: pending.companyName,
          type: pending.companyType,
          kind: pending.kind,
          accent: pending.accent,
          presentation: { create: {} }, // defaults; partner edits later
        },
      });

      const user = await tx.user.create({
        data: {
          id: newId(),
          partnerId,
          name: pending.adminName,
          email: pending.adminEmail,
          phone: pending.adminPhone,
          role: 'admin',
          locationId: null,
          passwordHash: pending.passwordHash,
          mustChangePassword: false,
        },
      });

      // Grant exactly the product they signed up for — never a default. Same
      // transaction as the partner + admin, so a partner can never exist without
      // the entitlement it was created for.
      await this.products.grantWithin(tx, partnerId, pending.product);

      // A `single` (solo professional) gets their one address provisioned
      // regardless of product. Location is ORGANIZATION-level, not a booking
      // concept — bookings, course runs and vacancies all anchor to it, and a
      // chair being advertised needs an address more than anything else does.
      // It is presented as "Your address" in the backoffice, never as a branch
      // list. No product may be a prerequisite for another.
      if (pending.kind === 'single') {
        const locationId = newId();
        await tx.location.create({
          data: { id: locationId, partnerId, name: pending.companyName, address: '', phone: pending.adminPhone },
        });

        // The bookable Specialist, on the other hand, IS booking-specific: it
        // carries a schedule and exists to be reserved. A solo pro who signed
        // up for vacancies has nothing to book, so creating one would leave
        // every organization carrying booking data it never asked for.
        if (pending.product === 'bookings') {
          await tx.specialist.create({
            data: {
              id: newId(),
              partnerId,
              locationId,
              name: pending.adminName,
              title: pending.companyType,
              phone: pending.adminPhone,
              schedule: SOLO_DEFAULT_SCHEDULE,
            },
          });
        }
      }

      await tx.pendingRegistration.update({
        where: { id: pending.id },
        data: { consumedAt: new Date() },
      });

      return user;
    });
  }

  // ── guards ────────────────────────────────────────────────

  private async assertSlugFree(slug: string) {
    const existing = await this.prisma.partner.findUnique({ where: { slug }, select: { id: true } });
    if (existing) {
      throw AppException.conflict(ErrorCode.SLUG_TAKEN, `The handle "${slug}" is already taken`);
    }
  }

  private async assertEmailFree(email: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.EMAIL_TAKEN, `The email "${email}" is already registered`);
    }
  }

  private async assertPhoneFree(phone: string) {
    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.PHONE_TAKEN, `The phone "${phone}" is already registered`);
    }
  }

  /** Is a slug available for signup (live check on the marketing form)? */
  async slugAvailable(slug: string): Promise<boolean> {
    const normalized = slugify(slug);
    if (normalized.length < 2) return false;
    const taken = await this.prisma.partner.findUnique({
      where: { slug: normalized },
      select: { id: true },
    });
    return !taken;
  }
}

function slugify(v: string): string {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
