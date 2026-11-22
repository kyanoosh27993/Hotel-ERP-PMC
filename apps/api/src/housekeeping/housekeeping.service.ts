/**
 * housekeeping.service.ts — فاز ۱۰ (موج ۱): وظایف خانه‌داری، بازرسی، تعمیرات، لاندری، اشیای جامانده.
 * سند تحلیل: docs/08-back-office/PHASE10-HOUSEKEEPING-ASSETS-SERVICES.md — قواعد:
 * پایان وظیفهٔ نظافت اتاق آزاد → CLEAN/AVAILABLE؛ بازرسی رد → DIRTY؛ حذف فیزیکی ممنوع (فقط CANCELED)؛
 * رویدادها با Outbox هم‌تراکنشی (housekeeping.task.completed / maintenance.request.created).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RoomTaskKind, TaskPriority } from '@prisma/client';
import {
  EVENT_NAMES,
  type HousekeepingTaskCompletedPayload,
  type MaintenanceRequestCreatedPayload,
} from '@hotel-erp/contracts';
import { OutboxService } from '../outbox/outbox.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class HousekeepingService {
  constructor(private readonly prisma: PrismaService, private readonly outbox: OutboxService) {}

  // ───────────── وظایف اتاق ─────────────

  async createTask(input: {
    roomCode: string;
    kind: RoomTaskKind;
    priority?: TaskPriority;
    scheduledDate: string;
    assigneeId?: string | null;
    note?: string | null;
    userId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { code: input.roomCode } });
      if (!room) throw new NotFoundException('اتاق یافت نشد');
      const task = await tx.roomTask.create({
        data: {
          roomId: room.id,
          kind: input.kind,
          priority: input.priority ?? 'NORMAL',
          scheduledDate: new Date(input.scheduledDate),
          assigneeId: input.assigneeId ?? null,
          note: input.note ?? null,
          createdById: input.userId,
        },
      });
      return { id: task.id, roomCode: room.code, kind: task.kind, status: task.status, scheduledDate: input.scheduledDate };
    });
  }

  async assignTask(taskId: string, assigneeId: string | null) {
    const task = await this.prisma.roomTask.update({
      where: { id: taskId },
      data: { assigneeId },
    }).catch(() => null);
    if (!task) throw new NotFoundException('وظیفه یافت نشد');
    return { id: task.id, status: task.status, assigneeId: task.assigneeId };
  }

  async startTask(taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "room_tasks" WHERE id = ${taskId}::uuid FOR UPDATE`;
      const task = await tx.roomTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('وظیفه یافت نشد');
      if (task.status === 'DONE' || task.status === 'CANCELED') {
        throw new BadRequestException('وظیفهٔ انجام‌شده/لغوشده قابل شروع نیست');
      }
      const updated = await tx.roomTask.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  /** پایان وظیفه — با قواعد وضعیت اتاق و رویداد هم‌تراکنشی */
  async completeTask(input: { taskId: string; note?: string | null; userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "room_tasks" WHERE id = ${input.taskId}::uuid FOR UPDATE`;
      const task = await tx.roomTask.findUnique({ where: { id: input.taskId }, include: { room: true } });
      if (!task) throw new NotFoundException('وظیفه یافت نشد');
      if (task.status === 'CANCELED') throw new BadRequestException('وظیفه لغو شده است');
      if (task.status === 'DONE') throw new BadRequestException('وظیفه قبلاً انجام شده است');

      const done = await tx.roomTask.update({
        where: { id: task.id },
        data: { status: 'DONE', doneAt: new Date(), note: input.note ?? task.note },
      });

      // قواعد وضعیت اتاق (پیوند با فاز ۴)
      if (task.kind === 'CLEANING' || task.kind === 'TURNDOWN') {
        await tx.room.update({
          where: { id: task.roomId },
          data: { hkStatus: 'CLEAN', ...(task.room.status === 'DIRTY' ? { status: 'AVAILABLE' } : {}) },
        });
      } else if (task.kind === 'INSPECTION') {
        // بازرسی خودکار از طریق recordInspection انجام می‌شود؛ اینجا فقط ثبت وضعیت انجام
      }

      const assignee = done.assigneeId
        ? await tx.user.findUnique({ where: { id: done.assigneeId }, select: { username: true } })
        : null;
      const payload: HousekeepingTaskCompletedPayload = {
        taskId: done.id,
        roomCode: task.room.code,
        kind: done.kind,
        assigneeUsername: assignee?.username ?? null,
        completedAt: (done.doneAt ?? new Date()).toISOString(),
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.HOUSEKEEPING_TASK_COMPLETED,
        aggregate: 'room_task',
        idempotencyKey: `housekeeping.task.done.${done.id}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'housekeeping',
      });
      return { id: done.id, status: done.status, roomCode: task.room.code };
    });
  }

  async cancelTask(taskId: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "room_tasks" WHERE id = ${taskId}::uuid FOR UPDATE`;
      const task = await tx.roomTask.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('وظیفه یافت نشد');
      if (task.status === 'DONE') throw new BadRequestException('وظیفهٔ انجام‌شده قابل لغو نیست');
      const updated = await tx.roomTask.update({
        where: { id: taskId },
        data: { status: 'CANCELED', note: `CANCELED: ${note}` },
      });
      return { id: updated.id, status: updated.status };
    });
  }

  async listTasks(filter: { date?: string; status?: string; assigneeId?: string; limit?: number }) {
    const rows = await this.prisma.roomTask.findMany({
      where: {
        ...(filter.date ? { scheduledDate: new Date(filter.date) } : {}),
        ...(filter.status ? { status: filter.status as 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELED' } : {}),
        ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(filter.limit ?? 100, 300),
      include: { room: { select: { code: true } } },
    });
    return rows.map((t) => ({
      id: t.id,
      roomCode: t.room.code,
      kind: t.kind,
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      scheduledDate: t.scheduledDate.toISOString().slice(0, 10),
      note: t.note,
    }));
  }

  // ───────────── بازرسی اتاق ─────────────

  /** ثبت بازرسی: قبول → INSPECTED؛ رد → DIRTY (اتاق دوباره نظافت لازم دارد) */
  async recordInspection(input: {
    roomCode: string;
    passed: boolean;
    score?: number | null;
    issues?: Array<string> | null;
    taskId?: string | null;
    userId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { code: input.roomCode } });
      if (!room) throw new NotFoundException('اتاق یافت نشد');
      const inspection = await tx.roomInspection.create({
        data: {
          roomId: room.id,
          taskId: input.taskId ?? null,
          passed: input.passed,
          score: input.score ?? null,
          issuesJson: input.issues?.length ? (input.issues as unknown as import('@prisma/client').Prisma.InputJsonValue) : undefined,
          inspectedById: input.userId,
        },
      });
      await tx.room.update({
        where: { id: room.id },
        data: { hkStatus: input.passed ? 'INSPECTED' : 'DIRTY' },
      });
      return { id: inspection.id, roomCode: room.code, passed: inspection.passed };
    });
  }

  // ───────────── تعمیرات ─────────────

  async createMaintenanceRequest(input: {
    roomCode?: string | null;
    assetCode?: string | null;
    title: string;
    description: string;
    priority?: TaskPriority;
    userId?: string;
  }) {
    const [request] = await this.prisma.$transaction(async (tx) => {
      const room = input.roomCode ? await tx.room.findUnique({ where: { code: input.roomCode } }) : null;
      if (input.roomCode && !room) throw new NotFoundException('اتاق یافت نشد');
      const asset = input.assetCode ? await tx.fixedAsset.findUnique({ where: { assetCode: input.assetCode } }) : null;
      if (input.assetCode && !asset) throw new NotFoundException('دارایی یافت نشد');
      const seq = (await tx.maintenanceRequest.count()) + 1;
      const req = await tx.maintenanceRequest.create({
        data: {
          requestNo: `MNT-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          roomId: room?.id ?? null,
          assetId: asset?.id ?? null,
          title: input.title,
          description: input.description,
          priority: input.priority ?? 'NORMAL',
          reportedById: input.userId,
        },
      });
      const payload: MaintenanceRequestCreatedPayload = {
        requestId: req.id,
        requestNo: req.requestNo,
        roomCode: room?.code ?? null,
        assetCode: asset?.assetCode ?? null,
        title: req.title,
        priority: req.priority,
      };
      await this.outbox.enqueue(tx, {
        eventName: EVENT_NAMES.MAINTENANCE_REQUEST_CREATED,
        aggregate: 'maintenance_request',
        idempotencyKey: `maintenance.req.created.${req.id}`,
        payload: payload as unknown as Record<string, unknown>,
        producer: 'housekeeping',
      });
      return [req] as const;
    });
    return { id: request.id, requestNo: request.requestNo, status: request.status, priority: request.priority };
  }

  async updateMaintenanceRequest(input: {
    id: string;
    status?: 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED';
    assigneeId?: string | null;
    resolutionNote?: string | null;
    costRials?: number | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "maintenance_requests" WHERE id = ${input.id}::uuid FOR UPDATE`;
      const req = await tx.maintenanceRequest.findUnique({ where: { id: input.id } });
      if (!req) throw new NotFoundException('درخواست تعمیر یافت نشد');
      if (req.status === 'DONE' || req.status === 'CANCELED') {
        throw new BadRequestException('درخواست بسته‌شده قابل تغییر نیست');
      }
      const data: Record<string, unknown> = {};
      if (input.assigneeId !== undefined) { data.assigneeId = input.assigneeId; data.status = input.status ?? 'ASSIGNED'; }
      if (input.status) data.status = input.status;
      if (input.resolutionNote) data.resolutionNote = input.resolutionNote;
      if (input.costRials != null) data.costRials = BigInt(input.costRials);
      if (input.status === 'DONE' || input.status === 'CANCELED') data.closedAt = new Date();
      const updated = await tx.maintenanceRequest.update({ where: { id: req.id }, data });
      return { id: updated.id, requestNo: updated.requestNo, status: updated.status, costRials: updated.costRials == null ? null : Number(updated.costRials) };
    });
  }

  async listMaintenance(status?: string, limit = 100) {
    const rows = await this.prisma.maintenanceRequest.findMany({
      where: status ? { status: status as 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELED' } : {},
      orderBy: [{ priority: 'desc' }, { openedAt: 'desc' }],
      take: Math.min(limit, 300),
      include: { room: { select: { code: true } }, asset: { select: { assetCode: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      roomCode: r.room?.code ?? null,
      assetCode: r.asset?.assetCode ?? null,
      title: r.title,
      priority: r.priority,
      status: r.status,
      costRials: r.costRials == null ? null : Number(r.costRials),
      openedAt: r.openedAt.toISOString(),
    }));
  }

  // ───────────── لاندری ─────────────

  async openLaundryBatch(input: { direction: 'OUT_WASH' | 'IN_RETURN'; userId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const seq = (await tx.laundryBatch.count()) + 1;
      const batch = await tx.laundryBatch.create({
        data: {
          code: `LDY-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          direction: input.direction,
          openedById: input.userId,
        },
      });
      return { id: batch.id, code: batch.code, direction: batch.direction, status: batch.status };
    });
  }

  /** ثبت/جمع اقلام بچ — upsert با کلید (بچ، قلم) */
  async upsertLaundryMovement(input: { batchId: string; linenCode: string; qty: number; userId?: string }) {
    if (input.qty <= 0) throw new BadRequestException('تعداد باید مثبت باشد');
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.laundryBatch.findUnique({ where: { id: input.batchId } });
      if (!batch) throw new NotFoundException('بچ لاندری یافت نشد');
      if (batch.status !== 'OPEN') throw new BadRequestException('بچ بسته شده است');
      const item = await tx.linenItem.findUnique({ where: { code: input.linenCode } });
      if (!item) throw new NotFoundException('قلم لاندری یافت نشد');
      const movement = await tx.laundryMovement.upsert({
        where: { batchId_linenItemId: { batchId: batch.id, linenItemId: item.id } },
        create: { batchId: batch.id, linenItemId: item.id, qty: input.qty, recordedById: input.userId },
        update: { qty: input.qty, recordedById: input.userId },
      });
      return { id: movement.id, batchCode: batch.code, linenCode: item.code, qty: movement.qty };
    });
  }

  async closeLaundryBatch(batchId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "laundry_batches" WHERE id = ${batchId}::uuid FOR UPDATE`;
      const batch = await tx.laundryBatch.findUnique({ where: { id: batchId } });
      if (!batch) throw new NotFoundException('بچ لاندری یافت نشد');
      if (batch.status !== 'OPEN') throw new BadRequestException('این بچ قبلاً بسته شده است');
      await tx.laundryBatch.update({
        where: { id: batchId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      return { id: batch.id, code: batch.code, status: 'CLOSED' as const };
    });
  }

  async listLaundry(limit = 50) {
    const rows = await this.prisma.laundryBatch.findMany({
      orderBy: { openedAt: 'desc' },
      take: Math.min(limit, 200),
      include: { movements: { include: { item: { select: { code: true, nameFa: true } } } } },
    });
    return rows.map((b) => ({
      id: b.id,
      code: b.code,
      direction: b.direction,
      status: b.status,
      items: b.movements.map((m) => ({ code: m.item.code, name: m.item.nameFa, qty: m.qty })),
    }));
  }

  // ───────────── اشیای جامانده ─────────────

  async registerLostFound(input: {
    roomCode: string;
    itemDesc: string;
    storageLocation: string;
    note?: string | null;
    userId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({ where: { code: input.roomCode } });
      if (!room) throw new NotFoundException('اتاق یافت نشد');
      const seq = (await tx.lostAndFound.count()) + 1;
      const row = await tx.lostAndFound.create({
        data: {
          code: `LNF-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`,
          roomId: room.id,
          itemDesc: input.itemDesc,
          storageLocation: input.storageLocation,
          note: input.note ?? null,
          foundById: input.userId,
        },
      });
      return { id: row.id, code: row.code, status: row.status };
    });
  }

  async resolveLostFound(input: { id: string; action: 'RETURNED' | 'DISPOSED'; returnedTo?: string | null }) {
    if (input.action === 'RETURNED' && (!input.returnedTo || input.returnedTo.trim().length < 2)) {
      throw new BadRequestException('برای تحویل، نام گیرنده الزامی است');
    }
    const row = await this.prisma.lostAndFound.update({
      where: { id: input.id },
      data: {
        status: input.action,
        returnedTo: input.returnedTo ?? null,
        returnedAt: input.action === 'RETURNED' ? new Date() : null,
      },
    }).catch(() => null);
    if (!row) throw new NotFoundException('رکورد اشیای جامانده یافت نشد');
    return { id: row.id, code: row.code, status: row.status, returnedTo: row.returnedTo };
  }

  async listLostFound(status?: string, limit = 100) {
    const rows = await this.prisma.lostAndFound.findMany({
      where: status ? { status: status as 'STORED' | 'RETURNED' | 'DISPOSED' } : {},
      orderBy: { foundAt: 'desc' },
      take: Math.min(limit, 300),
      include: { room: { select: { code: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      roomCode: r.room.code,
      itemDesc: r.itemDesc,
      storageLocation: r.storageLocation,
      status: r.status,
      returnedTo: r.returnedTo,
      foundAt: r.foundAt.toISOString(),
    }));
  }
}
