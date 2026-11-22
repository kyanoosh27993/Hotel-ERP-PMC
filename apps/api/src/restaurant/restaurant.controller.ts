/**
 * restaurant.controller.ts — فاز ۶ (موج ۲): مسیرهای نسخه‌دار /api/v1/restaurant/...
 * تخفیف فقط با مجوز pos.discount؛ گردش آشپزخانه با restaurant.kds.
 */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequireAnyPermissions, RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { AuthenticatedRequest } from '../common/authenticated.request';
import { RestaurantService } from './restaurant.service';

export class CreateAreaDto {
  @IsString()
  outletCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;
}

export class CreateTableDto {
  @IsString()
  areaId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(24)
  code!: string;

  @IsInt()
  @Min(1)
  seats!: number;
}

export class CreateMenuItemDto {
  @IsString()
  categoryCode!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(24)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;

  @IsInt()
  @Min(1)
  priceRials!: number;

  @IsOptional()
  @IsString()
  recipeCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxRateBps?: number;
}

export class CreateRecipeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  code!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameFa!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  yieldPortions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsArray()
  lines!: Array<{ stockItemCode: string; qtyPerPortion: number; wasteFactorBps?: number }>;
}

export class OrderItemInputDto {
  @IsString()
  menuItemCode!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class OpenOrderDto {
  @IsString()
  outletCode!: string;

  @IsOptional()
  @IsString()
  tableCode?: string;

  @IsIn(['DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE'])
  mode!: 'DINE_IN' | 'TAKEAWAY' | 'ROOM_SERVICE';

  @IsOptional()
  @IsString()
  stayCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  guestName?: string;

  @IsArray()
  items!: OrderItemInputDto[];

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class AddItemsDto {
  @IsArray()
  items!: OrderItemInputDto[];
}

export class CancelItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class DiscountDto {
  @IsNumber()
  @Min(0)
  amountRials!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(240)
  reason!: string;
}

export class TicketStatusDto {
  @IsIn(['PREPARING', 'READY', 'SERVED'])
  status!: 'PREPARING' | 'READY' | 'SERVED';
}

@ApiTags('restaurant')
@ApiBearerAuth()
@Controller('restaurant')
export class RestaurantController {
  constructor(private readonly svc: RestaurantService) {}

  @Get('areas')
  @RequirePermissions(PERMISSIONS.RESTAURANT_VIEW)
  areas() {
    return this.svc.listAreas();
  }

  @Post('areas')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  createArea(@Body() dto: CreateAreaDto) {
    return this.svc.createArea(dto);
  }

  @Post('tables')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  createTable(@Body() dto: CreateTableDto) {
    return this.svc.createTable(dto);
  }

  @Get('menu')
  @RequirePermissions(PERMISSIONS.RESTAURANT_VIEW)
  menu() {
    return this.svc.listMenu();
  }

  @Post('menu-items')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  createMenuItem(@Body() dto: CreateMenuItemDto) {
    return this.svc.createMenuItem(dto);
  }

  @Post('recipes')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  createRecipe(@Body() dto: CreateRecipeDto) {
    return this.svc.createRecipe(dto);
  }

  @Post('orders')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  openOrder(@Body() dto: OpenOrderDto, @Req() req: AuthenticatedRequest) {
    return this.svc.openOrder({ ...dto, userId: req.user.id });
  }

  @Post('orders/:id/items')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  addItems(@Param('id') id: string, @Body() dto: AddItemsDto) {
    return this.svc.addItems(id, dto.items);
  }

  @Post('orders/:id/items/:itemId/send')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  sendItem(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: AuthenticatedRequest) {
    return this.svc.sendItemToKitchen(id, itemId, req.user.id);
  }

  @Post('orders/:id/items/:itemId/cancel')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  cancelItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: CancelItemDto) {
    return this.svc.cancelItem(id, itemId, dto.reason);
  }

  @Post('orders/:id/discount')
  @RequirePermissions(PERMISSIONS.POS_DISCOUNT)
  applyDiscount(@Param('id') id: string, @Body() dto: DiscountDto) {
    return this.svc.applyDiscount(id, dto.amountRials, dto.reason);
  }

  @Post('orders/:id/serve')
  @RequirePermissions(PERMISSIONS.RESTAURANT_ORDER)
  serveOrder(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.svc.serveOrder(id, req.user.id);
  }

  @Get('orders')
  @RequirePermissions(PERMISSIONS.RESTAURANT_VIEW)
  listOrders(@Query('limit') limit?: string) {
    return this.svc.listOrders(limit ? Number(limit) : undefined);
  }

  @Get('orders/:id')
  @RequirePermissions(PERMISSIONS.RESTAURANT_VIEW)
  getOrder(@Param('id') id: string) {
    return this.svc.getOrder(id);
  }

  @Get('kitchen/tickets')
  @RequireAnyPermissions(PERMISSIONS.RESTAURANT_VIEW, PERMISSIONS.RESTAURANT_KDS)
  tickets(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.svc.listKitchenTickets(status, limit ? Number(limit) : undefined);
  }

  @Post('kitchen/tickets/:id')
  @RequirePermissions(PERMISSIONS.RESTAURANT_KDS)
  updateTicket(@Param('id') id: string, @Body() dto: TicketStatusDto) {
    return this.svc.updateTicketStatus(id, dto.status);
  }
}
