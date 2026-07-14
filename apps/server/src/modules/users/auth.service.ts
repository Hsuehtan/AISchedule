import { Inject, Injectable } from '@nestjs/common';
import {
  ContactStatus,
  ContactType,
  IdentityStatus,
  IdentityType,
  TransactionStatus,
  UserStatus,
} from '@ai-schedule/db';
import {
  normalizeUsername,
  publicUserSchema,
  type LoginWithUsernameInput,
  type PublicUser,
  type RegisterWithUsernameInput,
} from '@ai-schedule/contracts';

import {
  APPLICATION_OPTIONS,
  type ResolvedApplicationOptions,
} from '../../platform/application-options.js';
import { DatabaseService } from '../../platform/database/database.service.js';
import {
  RUNTIME_CONFIGURATION,
  type RuntimeConfiguration,
} from '../../platform/runtime-configuration.js';
import { PasswordService } from './password.service.js';
import { createSessionToken, hashSessionToken } from './session-token.js';

export const SESSION_COOKIE_NAME = 'ai_schedule_session';

const PROFILE_INCLUDE = {
  identities: {
    where: { type: IdentityType.USERNAME },
    orderBy: { createdAt: 'asc' as const },
  },
  contacts: {
    where: { type: ContactType.PHONE },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

interface UserProfileRecord {
  readonly id: string;
  readonly nickname: string;
  readonly locale: string;
  readonly timezone: string;
  readonly identities: readonly {
    readonly identifier: string;
    readonly status: IdentityStatus;
  }[];
  readonly contacts: readonly {
    readonly value: string;
    readonly verifiedAt: Date | null;
    readonly status: ContactStatus;
  }[];
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: PublicUser;
}

export interface AuthenticatedSession {
  readonly userId: string;
  readonly credentialVersion: number;
  readonly expiresAt: Date;
  readonly user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(APPLICATION_OPTIONS) private readonly options: ResolvedApplicationOptions,
    @Inject(RUNTIME_CONFIGURATION) private readonly runtime: RuntimeConfiguration,
  ) {
    this.dummyPasswordHash = passwords.hash('invalid-user-timing-padding');
  }

  async register(input: RegisterWithUsernameInput): Promise<IssuedSession> {
    const now = new Date();
    const passwordHash = await this.passwords.hash(input.password);
    const username = input.username.normalize('NFKC').trim();
    const usernameNormalized = normalizeUsername(username);
    const token = createSessionToken();
    const expiresAt = this.sessionExpiry(now);
    const points = this.runtime.points;

    try {
      const user = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            aiPoints: points.value.grants.newUser,
            identities: {
              create: {
                type: IdentityType.USERNAME,
                identifier: username,
                identifierNormalized: usernameNormalized,
                status: IdentityStatus.ACTIVE,
                verifiedAt: now,
                lastUsedAt: now,
              },
            },
            passwordCredential: {
              create: { passwordHash, passwordChangedAt: now, credentialVersion: 1 },
            },
            ...(input.phone
              ? {
                  contacts: {
                    create: {
                      type: ContactType.PHONE,
                      value: input.phone,
                      valueNormalized: input.phone,
                      status: ContactStatus.UNVERIFIED,
                    },
                  },
                }
              : {}),
            pointTransactions: {
              create: {
                type: 'NEW_USER_GRANT',
                amount: points.value.grants.newUser,
                status: TransactionStatus.SUCCEEDED,
                reasonCode: 'NEW_USER_INITIAL_GRANT',
                configVersion: points.version,
                configHash: points.hash,
                unitCost: points.value.grants.newUser,
                balanceBefore: 0,
                balanceAfter: points.value.grants.newUser,
              },
            },
          },
          include: PROFILE_INCLUDE,
        });

        await transaction.authSession.create({
          data: {
            userId: created.id,
            tokenHash: hashSessionToken(token),
            credentialVersion: created.credentialVersion,
            expiresAt,
            lastSeenAt: now,
          },
        });

        return created;
      });

      return { token, expiresAt, user: this.toPublicUser(user) };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new UsernameAlreadyExistsError();
      throw error;
    }
  }

  async login(input: LoginWithUsernameInput): Promise<IssuedSession | null> {
    const usernameNormalized = normalizeUsername(input.username);
    const identity = await this.database.client.userIdentity.findUnique({
      where: {
        type_identifierNormalized: {
          type: IdentityType.USERNAME,
          identifierNormalized: usernameNormalized,
        },
      },
      include: {
        user: {
          include: {
            ...PROFILE_INCLUDE,
            passwordCredential: true,
          },
        },
      },
    });

    const passwordHash =
      identity?.user.passwordCredential?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await this.passwords.verify(passwordHash, input.password);
    const credential = identity?.user.passwordCredential;
    if (
      !identity ||
      !passwordMatches ||
      !credential ||
      identity.status !== IdentityStatus.ACTIVE ||
      identity.user.status !== UserStatus.ACTIVE ||
      identity.user.credentialVersion !== credential.credentialVersion
    ) {
      return null;
    }

    const now = new Date();
    const expiresAt = this.sessionExpiry(now);
    const token = createSessionToken();

    await this.database.client.$transaction([
      this.database.client.userIdentity.update({
        where: { id: identity.id },
        data: { lastUsedAt: now },
      }),
      this.database.client.authSession.create({
        data: {
          userId: identity.userId,
          tokenHash: hashSessionToken(token),
          credentialVersion: credential.credentialVersion,
          expiresAt,
          lastSeenAt: now,
        },
      }),
    ]);

    return { token, expiresAt, user: this.toPublicUser(identity.user) };
  }

  async resolveSession(token: string | undefined): Promise<AuthenticatedSession | null> {
    if (!token) return null;

    const now = new Date();
    const session = await this.database.client.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: {
          include: {
            ...PROFILE_INCLUDE,
            passwordCredential: true,
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE ||
      session.credentialVersion !== session.user.credentialVersion ||
      session.user.passwordCredential?.credentialVersion !== session.credentialVersion
    ) {
      return null;
    }

    await this.database.client.authSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });

    return {
      userId: session.userId,
      credentialVersion: session.credentialVersion,
      expiresAt: session.expiresAt,
      user: this.toPublicUser(session.user),
    };
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;

    await this.database.client.authSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getUser(userId: string): Promise<PublicUser | null> {
    const user = await this.database.client.user.findUnique({
      where: { id: userId },
      include: PROFILE_INCLUDE,
    });
    return user ? this.toPublicUser(user) : null;
  }

  private sessionExpiry(now: Date): Date {
    return new Date(now.getTime() + this.options.sessionTtlDays * 24 * 60 * 60 * 1_000);
  }

  private toPublicUser(user: UserProfileRecord): PublicUser {
    const username = user.identities.find((identity) => identity.status === IdentityStatus.ACTIVE);
    if (!username) throw new Error('active username identity is missing');

    const phone = user.contacts[0] ?? null;
    return publicUserSchema.parse({
      id: user.id,
      username: username.identifier,
      nickname: user.nickname,
      phone: phone?.value ?? null,
      phoneVerified:
        phone !== null && phone.status === ContactStatus.VERIFIED && phone.verifiedAt !== null,
      locale: user.locale,
      timezone: user.timezone,
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}

export class UsernameAlreadyExistsError extends Error {}
