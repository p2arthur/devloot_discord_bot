import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordRoleService } from './discord-role.service';

@Injectable()
export class DiscordXpService {
  private readonly logger = new Logger(DiscordXpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roleService: DiscordRoleService,
  ) {}

  async addXp(userId: string, amount: number): Promise<number> {
    // Use upsert to safely create or update user without race conditions
    const user = await this.prisma.user.upsert({
      where: { discordId: userId },
      update: { xp: { increment: amount } },
      create: {
        discordId: userId,
        githubId: -Date.now(), // Temporary negative ID until user onboards
        xp: amount,
      },
    });

    this.logger.log(
      user.githubId < 0
        ? `[xp] Created pending user for ${userId} (githubId: ${user.githubId}), +${amount} XP`
        : `[xp] +${amount} for ${userId} → total ${user.xp} XP`,
    );

    await this.roleService.syncTierRole(userId, user.xp);
    return user.xp;
  }

  async addXpByUserId(userId: number, amount: number): Promise<number> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: amount } },
    });
    this.logger.log(`[xp] +${amount} for user#${userId} → total ${user.xp} XP`);

    if (user.discordId) {
      await this.roleService.syncTierRole(user.discordId, user.xp);
    }

    return user.xp;
  }

  async addProposalXp(proposerId: string): Promise<number> {
    return this.addXp(proposerId, 25);
  }

  async addVoteXp(userId: string): Promise<number> {
    return this.addXp(userId, 2);
  }
}
