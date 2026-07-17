import { createHash } from 'node:crypto';

import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { AiCapabilityRule } from '@ai-schedule/contracts';

import { DatabaseService } from '../../../platform/database/database.service.js';
import {
  RUNTIME_CONFIGURATION,
  type RuntimeConfiguration,
} from '../../../platform/runtime-configuration.js';

const CAPABILITY_SYNC_LOCK = 71_520_260_717n;

export function capabilityRuleHash(rule: AiCapabilityRule): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        capabilityCode: rule.capabilityCode,
        endpointCode: rule.endpointCode,
        name: rule.name,
        callsModelApi: rule.callsModelApi,
        pointsCost: rule.pointsCost,
        costRuleVersion: rule.costRuleVersion,
        enabled: rule.enabled,
      }),
      'utf8',
    )
    .digest('hex');
}

@Injectable()
export class CapabilityRegistryService implements OnApplicationBootstrap {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RUNTIME_CONFIGURATION) private readonly runtime: RuntimeConfiguration,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.synchronize();
  }

  async synchronize(): Promise<void> {
    const loaded = this.runtime.points;
    await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(${CAPABILITY_SYNC_LOCK})::text AS "locked"
      `;

      for (const rule of loaded.value.capabilities) {
        const ruleHash = capabilityRuleHash(rule);
        const existing = await transaction.aiCapability.findUnique({
          where: {
            capabilityCode_costRuleVersion: {
              capabilityCode: rule.capabilityCode,
              costRuleVersion: rule.costRuleVersion,
            },
          },
        });

        if (existing && existing.ruleHash !== ruleHash) {
          throw new CapabilityRuleVersionConflictError(
            rule.capabilityCode,
            rule.endpointCode,
            rule.costRuleVersion,
          );
        }

        await transaction.aiCapability.updateMany({
          where: {
            capabilityCode: rule.capabilityCode,
            status: 'ACTIVE',
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { status: 'INACTIVE' },
        });

        const status = rule.enabled ? ('ACTIVE' as const) : ('INACTIVE' as const);
        if (existing) {
          if (existing.status !== status) {
            await transaction.aiCapability.update({
              where: { id: existing.id },
              data: { status },
            });
          }
          continue;
        }

        await transaction.aiCapability.create({
          data: {
            capabilityCode: rule.capabilityCode,
            endpointCode: rule.endpointCode,
            name: rule.name,
            callsModelApi: rule.callsModelApi,
            pointsCost: rule.pointsCost,
            costRuleVersion: rule.costRuleVersion,
            status,
            effectiveAt: new Date(),
            configVersion: loaded.version,
            configHash: loaded.hash,
            ruleHash,
          },
        });
      }
    });
  }
}

export class CapabilityRuleVersionConflictError extends Error {
  constructor(capabilityCode: string, endpointCode: string, costRuleVersion: string) {
    super(
      `Capability ${capabilityCode}/${endpointCode} changed without a new rule version (${costRuleVersion})`,
    );
    this.name = 'CapabilityRuleVersionConflictError';
  }
}
