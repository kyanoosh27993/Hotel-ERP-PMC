import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { IntegrationHubService } from './integration-hub.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationController {
  constructor(private readonly hub: IntegrationHubService) {}

  @RequirePermissions(PERMISSIONS.INTEGRATIONS_VIEW)
  @Get()
  async list() {
    return { data: await this.hub.status() };
  }

  @RequirePermissions(PERMISSIONS.INTEGRATIONS_VIEW)
  @Get(':id/health')
  async health(@Param('id') id: string) {
    const adapter = this.hub.get(id);
    return { data: { id, health: await adapter.health(), lastError: adapter.lastError() } };
  }
}
