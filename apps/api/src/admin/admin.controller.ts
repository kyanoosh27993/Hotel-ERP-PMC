/**
 * admin.controller.ts — مدیریت کاربران/گروه‌ها/ماتریس دسترسی (نسخهٔ ۳٫۳)
 * همهٔ مسیرها نیازمند مجوز users.manage (کنترل سمت سرور — قرارداد §5).
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateRoleDto, CreateUserDto, MemberDto, SetRolePermissionsDto, UpdateRoleDto, UpdateUserDto } from './admin.dto';
import { RequirePermissions } from '../iam/permissions.guard';
import { CurrentUser } from '../iam/current-user.decorator';
import { PERMISSIONS } from '../iam/permissions';

@ApiTags('admin')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.USERS_MANAGE)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /* ── کاربران ── */

  @Get('users')
  async users() {
    return { data: await this.admin.listUsers() };
  }

  @Post('users')
  async createUser(@Body() dto: CreateUserDto, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.createUser(dto, actor.id) };
  }

  @Patch('users/:id')
  async updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.updateUser(id, dto, actor.id) };
  }

  /** حذف = غیرفعال‌سازی (اسناد مالی به کاربر ارجاع دارند) */
  @Delete('users/:id')
  async deactivateUser(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.deactivateUser(id, actor.id) };
  }

  /* ── گروه‌های کاربری ── */

  @Get('roles')
  async roles() {
    return { data: await this.admin.listRoles() };
  }

  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.createRole(dto, actor.id) };
  }

  @Patch('roles/:id')
  async updateRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.updateRole(id, dto, actor.id) };
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.deleteRole(id, actor.id) };
  }

  /** جایگزینی کامل ماتریس دسترسی گروه */
  @Put('roles/:id/permissions')
  async setRolePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() actor: { id: string },
  ) {
    return { data: await this.admin.setRolePermissions(id, dto, actor.id) };
  }

  @Get('roles/:id/members')
  async roleMembers(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.admin.listRoleMembers(id) };
  }

  @Post('roles/:id/members')
  async addMember(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberDto, @CurrentUser() actor: { id: string }) {
    return { data: await this.admin.addMember(id, dto, actor.id) };
  }

  @Delete('roles/:id/members/:userId')
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: { id: string },
  ) {
    return { data: await this.admin.removeMember(id, userId, actor.id) };
  }

  /* ── کاتالوگ دسترسی‌ها (گروه‌بندی ماژول) ── */

  @Get('permission-catalog')
  async catalog() {
    return { data: this.admin.permissionCatalog() };
  }
}
