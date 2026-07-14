import { IdentityStatus, IdentityType, type DatabaseClient } from '@ai-schedule/db';
import { normalizeUsername, passwordSchema } from '@ai-schedule/contracts';

import type { PasswordService } from '../modules/users/password.service.js';

export type AdminUserLookup = { readonly userId: string } | { readonly username: string };

export interface SetAdminPasswordInput {
  readonly lookup: AdminUserLookup;
  readonly newPassword: string;
  readonly operator: string;
  readonly reason: string;
}

export interface SetAdminPasswordResult {
  readonly userId: string;
  readonly credentialVersion: number;
  readonly sessionsRevoked: number;
}

export class AdminPasswordService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly passwords: PasswordService,
  ) {}

  async setPassword(input: SetAdminPasswordInput): Promise<SetAdminPasswordResult> {
    const newPassword = passwordSchema.parse(input.newPassword);
    const userId = await this.resolveUserId(input.lookup);
    if (!userId) throw new AdminUserNotFoundError();
    const target = await this.database.user.findUnique({
      where: { id: userId },
      include: { passwordCredential: true },
    });
    if (!target?.passwordCredential) throw new AdminUserNotFoundError();
    if (target.credentialVersion !== target.passwordCredential.credentialVersion) {
      throw new AdminCredentialVersionConflictError();
    }

    const expectedCredentialVersion = target.credentialVersion;
    const credentialVersion = expectedCredentialVersion + 1;
    const passwordHash = await this.passwords.hash(newPassword);

    return this.database.$transaction(async (transaction) => {
      const claimedUser = await transaction.user.updateMany({
        where: { id: userId, credentialVersion: expectedCredentialVersion },
        data: { credentialVersion },
      });
      if (claimedUser.count !== 1) {
        throw new AdminCredentialVersionConflictError();
      }

      const now = new Date();
      const claimedCredential = await transaction.userPasswordCredential.updateMany({
        where: { userId, credentialVersion: expectedCredentialVersion },
        data: { passwordHash, passwordChangedAt: now, credentialVersion },
      });
      if (claimedCredential.count !== 1) throw new AdminCredentialVersionConflictError();

      const revoked = await transaction.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.adminAuditEvent.create({
        data: {
          operator: input.operator,
          actionType: 'PASSWORD_SET',
          targetUserId: userId,
          reason: input.reason,
          requestPayload: {
            lookupType: 'userId' in input.lookup ? 'USER_ID' : 'USERNAME',
          },
          resultPayload: { credentialVersion, sessionsRevoked: revoked.count },
        },
      });

      return { userId, credentialVersion, sessionsRevoked: revoked.count };
    });
  }

  private async resolveUserId(lookup: AdminUserLookup): Promise<string | null> {
    if ('userId' in lookup) {
      const user = await this.database.user.findUnique({
        where: { id: lookup.userId },
        select: { id: true },
      });
      return user?.id ?? null;
    }

    const identity = await this.database.userIdentity.findUnique({
      where: {
        type_identifierNormalized: {
          type: IdentityType.USERNAME,
          identifierNormalized: normalizeUsername(lookup.username),
        },
      },
      select: { userId: true, status: true },
    });
    return identity?.status === IdentityStatus.ACTIVE ? identity.userId : null;
  }
}

export class AdminUserNotFoundError extends Error {
  constructor() {
    super('未找到目标用户');
    this.name = 'AdminUserNotFoundError';
  }
}

export class AdminCredentialVersionConflictError extends Error {
  constructor() {
    super('用户凭证已发生变化，请重新执行');
    this.name = 'AdminCredentialVersionConflictError';
  }
}
