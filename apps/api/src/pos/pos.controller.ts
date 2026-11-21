import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequirePermissions } from '../iam/permissions.guard';
import { PERMISSIONS } from '../iam/permissions';
import { PosService } from './pos.service';
import { AuthenticatedRequest } from '../common/authenticated.request';

export class PosLineDto {
  @IsString()
  @MaxLength(80)
  itemName!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsInt()
  @Min(0)
  unitPriceRials!: number; // ریال صحیح — ممیز شناور ممنوع
}

export class ServeOrderDto {
  @IsString()
  @MaxLength(64)
  outletId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PosLineDto)
  lines!: PosLineDto[];

  @IsInt()
  @Min(0)
  taxRatePermille!: number;

  @IsOptional()
  @IsString()
  folioId?: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

@ApiTags('pos')
@ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService) {}

  @RequirePermissions(PERMISSIONS.POS_ORDER_CREATE)
  @Post('orders')
  async serve(@Body() dto: ServeOrderDto, @Req() req: AuthenticatedRequest) {
    const result = await this.pos.serveOrder({
      outletId: dto.outletId,
      lines: dto.lines.map((l) => ({ itemName: l.itemName, qty: l.qty, unitPriceRials: BigInt(Math.trunc(l.unitPriceRials)) })),
      taxRatePermille: dto.taxRatePermille,
      folioId: dto.folioId ?? null,
      idempotencyKey: dto.idempotencyKey,
      servedByUserId: req.user.id,
    });
    return { data: result };
  }
}
