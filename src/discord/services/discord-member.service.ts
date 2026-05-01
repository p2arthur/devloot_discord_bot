import { Injectable, Logger } from '@nestjs/common';
import { GuildMember } from 'discord.js';
import { DiscordRoleService } from './discord-role.service';

@Injectable()
export class DiscordMemberService {
  private readonly logger = new Logger(DiscordMemberService.name);

  constructor(private readonly roleService: DiscordRoleService) {}

  async handleNewMember(member: GuildMember): Promise<void> {
    this.logger.log(
      `[member] New member joined: ${member.user.tag} (${member.user.id})`,
    );

    try {
      const verifiedRoleId = await this.roleService.fetchRoleIdByName('Verified');
      this.logger.log(
        `[member] ${member.user.tag} joined — Verified role ID: ${verifiedRoleId ?? 'not found (run /setup-server)'}`,
      );
    } catch (err) {
      this.logger.debug(
        `[member] Could not log role info: ${this.describeError(err)}`,
      );
    }
  }

  private describeError(err: unknown): string {
    if (typeof err === 'object' && err && 'message' in err) {
      return String((err as { message?: unknown }).message ?? err);
    }
    return String(err);
  }
}
