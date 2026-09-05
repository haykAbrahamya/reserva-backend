import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Professional } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { PasswordService } from '@/auth/password.service';
import { AppException } from '@/common/errors/app.exception';
import { ErrorCode } from '@/common/errors/error-codes';
import { newId, newTokenId } from '@/common/ids';
import { normalizePhone } from '@/common/utils/phone';
import type { ProfessionalJwtPayload } from './professional.types';
import type { RegisterProfessionalDto, UpdateProfessionalDto } from './dto/professional.dto';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface ProfessionalAuthResult extends Tokens {
  professional: PublicProfessional;
}

/** What the browser is allowed to see about an account. Never the hash. */
export interface PublicProfessional {
  id: string;
  name: string;
  phone: string;
  email: string;
  specialtyKeys: string[];
  areaKeys: string[];
  experienceYears: number | null;
  about: string;
  cvUrl: string;
  locale: string;
}

/**
 * Professional accounts: register, sign in, profile.
 *
 * The third auth realm. It is a near-copy of the platform one on purpose —
 * hashed rotating refresh tokens, typed access tokens, the same error codes —
 * because the one thing that must never differ between realms is how sessions
 * are issued and revoked. Where it differs is deliberate and noted.
 *
 * The largest difference: registration is PUBLIC and unauthenticated. Platform
 * operators are created by other operators; professionals create themselves
 * from a website, which makes this the most exposed write in the product after
 * the application form. Hence the same normalization and duplicate rules the
 * partner signup uses, and no email verification step — a phone number people
 * answer is worth more here than an address they confirm.
 */
@Injectable()
export class ProfessionalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  // ── Registration ──────────────────────────────────────────

  async register(dto: RegisterProfessionalDto): Promise<ProfessionalAuthResult> {
    const phone = normalizePhone(dto.phone);
    const email = dto.email?.trim().toLowerCase() || null;

    await this.assertPhoneFree(phone);
    if (email) await this.assertEmailFree(email);

    const professional = await this.prisma.professional.create({
      data: {
        id: newId(),
        name: dto.name.trim(),
        phone,
        email,
        passwordHash: await this.passwords.hash(dto.password),
        specialtyKeys: dedupe(dto.specialtyKeys ?? []),
        areaKeys: dedupe(dto.areaKeys ?? []),
        experienceYears: dto.experienceYears ?? null,
        about: dto.about?.trim() ?? '',
        locale: dto.locale ?? 'hy',
      },
    });

    /*
     * Signed in immediately, no activation email.
     *
     * The partner signup emails a magic link because creating a Partner is
     * heavy and mistyped addresses cost real support time. Registering a job
     * seeker is not: the account holds only what they just typed, and standing
     * between someone and the listing they came to apply for is how a board
     * loses the applicant it exists to deliver.
     */
    const tokens = await this.issueTokens(professional);
    return { ...tokens, professional: toPublic(professional) };
  }

  // ── Sessions ──────────────────────────────────────────────

  /**
   * Sign in with an email OR a phone number.
   *
   * Both, because half of this audience will have registered with a phone and
   * no address, and asking them to remember which is a support ticket. An input
   * that starts with a digit or a plus is treated as a phone and normalized;
   * anything else is an email.
   */
  async login(identifier: string, password: string): Promise<ProfessionalAuthResult> {
    const professional = await this.findByLogin(identifier);
    if (!professional || !professional.active || professional.deletedAt) throw invalidCreds();

    const ok = await this.passwords.verify(professional.passwordHash, password);
    if (!ok) throw invalidCreds();

    await this.prisma.professional.update({
      where: { id: professional.id },
      data: { lastLogin: new Date() },
    });

    const tokens = await this.issueTokens(professional);
    return { ...tokens, professional: toPublic(professional) };
  }

  async refresh(refreshToken: string): Promise<ProfessionalAuthResult> {
    const payload = await this.verifyRefresh(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await this.prisma.professionalRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Refresh token is no longer valid', 401);
    }

    const professional = await this.prisma.professional.findUnique({ where: { id: payload.sub } });
    if (!professional || !professional.active || professional.deletedAt) throw invalidCreds();

    // Rotation: the presented token is spent, whether or not the new one is
    // ever used. A refresh token that survives its own use is a replay waiting
    // to happen.
    await this.prisma.professionalRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(professional);
    return { ...tokens, professional: toPublic(professional) };
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.professionalRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Profile ───────────────────────────────────────────────

  async me(id: string): Promise<PublicProfessional> {
    const professional = await this.prisma.professional.findUnique({ where: { id } });
    if (!professional || professional.deletedAt) throw AppException.notFound('Account not found');
    return toPublic(professional);
  }

  async update(id: string, dto: UpdateProfessionalDto): Promise<PublicProfessional> {
    const current = await this.prisma.professional.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw AppException.notFound('Account not found');

    // Contact details are identity here, so a change has to clear the same
    // uniqueness bar registration did — and only when it actually changed.
    const phone = dto.phone !== undefined ? normalizePhone(dto.phone) : undefined;
    if (phone && phone !== current.phone) await this.assertPhoneFree(phone);

    const email = dto.email !== undefined ? dto.email.trim().toLowerCase() || null : undefined;
    if (email && email !== current.email) await this.assertEmailFree(email);

    const updated = await this.prisma.professional.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(dto.specialtyKeys !== undefined && { specialtyKeys: dedupe(dto.specialtyKeys) }),
        ...(dto.areaKeys !== undefined && { areaKeys: dedupe(dto.areaKeys) }),
        ...(dto.experienceYears !== undefined && { experienceYears: dto.experienceYears }),
        ...(dto.about !== undefined && { about: dto.about.trim() }),
        ...(dto.locale !== undefined && { locale: dto.locale }),
      },
    });
    return toPublic(updated);
  }

  /**
   * The applications this account has made.
   *
   * Matched by professionalId only — NOT by phone. Retro-matching every
   * application that happens to share a number would hand someone a stranger's
   * history the moment a number is recycled or mistyped, and a job application
   * is exactly the kind of thing that must not leak that way.
   */
  async applications(id: string) {
    return this.prisma.vacancyApplication.findMany({
      where: { professionalId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        note: true,
        vacancy: {
          select: {
            id: true,
            title: true,
            titleI18n: true,
            specialty: { select: { roleName: true, roleNameI18n: true } },
            partner: { select: { name: true, nameI18n: true } },
          },
        },
      },
    });
  }

  // ── Internals ─────────────────────────────────────────────

  private async findByLogin(identifier: string): Promise<Professional | null> {
    const raw = identifier.trim();
    if (!raw) return null;

    // A leading digit or '+' means they typed a number. Anything else is an
    // address — no email starts with either.
    if (/^[+\d]/.test(raw)) {
      const phone = normalizePhone(raw);
      return this.prisma.professional.findUnique({ where: { phone } });
    }
    return this.prisma.professional.findUnique({ where: { email: raw.toLowerCase() } });
  }

  private async issueTokens(professional: Professional): Promise<Tokens> {
    const accessPayload: ProfessionalJwtPayload = {
      sub: professional.id,
      type: 'professional-access',
    };

    const accessOpts = {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL'),
    } as JwtSignOptions;
    const accessToken = await this.jwt.signAsync({ ...accessPayload }, accessOpts);

    const refreshOpts = {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    } as JwtSignOptions;
    const refreshToken = await this.jwt.signAsync(
      // `jti` keeps two tokens minted in the same second distinct — see newTokenId.
      { sub: professional.id, type: 'professional-refresh', jti: newTokenId() },
      refreshOpts,
    );

    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    await this.prisma.professionalRefreshToken.create({
      data: {
        id: newId(),
        professionalId: professional.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private async verifyRefresh(token: string): Promise<{ sub: string }> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; type: string }>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (p.type !== 'professional-refresh') throw new Error('wrong type');
      return p;
    } catch {
      throw new AppException(ErrorCode.TOKEN_INVALID, 'Invalid refresh token', 401);
    }
  }

  private async assertPhoneFree(phone: string) {
    const existing = await this.prisma.professional.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.PHONE_TAKEN, 'An account with this number already exists');
    }
  }

  private async assertEmailFree(email: string) {
    const existing = await this.prisma.professional.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw AppException.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
    }
  }
}

function invalidCreds() {
  return new AppException(
    ErrorCode.INVALID_CREDENTIALS,
    'Invalid credentials. Check your phone or email and password.',
    401,
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Keys arrive from checkbox lists, so a duplicate is a UI accident, not intent. */
function dedupe(keys: string[]): string[] {
  return [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
}

function toPublic(p: Professional): PublicProfessional {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email ?? '',
    specialtyKeys: p.specialtyKeys,
    areaKeys: p.areaKeys,
    experienceYears: p.experienceYears,
    about: p.about,
    cvUrl: p.cvUrl,
    locale: p.locale,
  };
}
