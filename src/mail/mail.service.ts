import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { activationEmail } from './templates/activation.template';

/**
 * Transactional email via SMTP (Gmail). If SMTP_USER/PASS are unset, mail
 * self-disables and just logs — so dev/boot never breaks on missing creds.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (!user || !pass) {
      this.logger.warn('SMTP creds not set — emails will be logged, not sent.');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT'),
      secure: this.config.get<number>('SMTP_PORT') === 465,
      auth: { user, pass },
    });
  }

  private get from(): string {
    return this.config.get<string>('MAIL_FROM') || 'Reserva <no-reply@reserva.am>';
  }

  private async send(to: string, subject: string, html: string, text: string) {
    if (!this.transporter) {
      this.logger.log(`[mail:disabled] to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html, text });
    } catch (e) {
      this.logger.error(`Failed to send "${subject}" to ${to}: ${(e as Error).message}`);
      throw e;
    }
  }

  /** Signup activation magic-link email. */
  async sendActivation(to: string, opts: { name: string; company: string; link: string }) {
    const { html, text, subject } = activationEmail(opts);
    await this.send(to, subject, html, text);
  }
}
