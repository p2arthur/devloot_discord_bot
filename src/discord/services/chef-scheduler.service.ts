import { Injectable, Logger } from '@nestjs/common';
import { DiscordRoleService } from './discord-role.service';

@Injectable()
export class ChefSchedulerService {
  private readonly logger = new Logger(ChefSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly roleService: DiscordRoleService) {}

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      const now = new Date();
      if (
        now.getUTCDay() === 1 &&
        now.getUTCHours() === 0 &&
        now.getUTCMinutes() === 0
      ) {
        this.logger.log('[cron] Running weekly Open Source Chef check');
        void this.roleService.checkWeeklyChef();
      }
    }, 60_000);
  }

  async runNow(): Promise<{ awarded: number; removed: number }> {
    return this.roleService.checkWeeklyChef();
  }
}
