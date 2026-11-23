/**
 * workflow.service.ts — فاز ۸ / F8-T6: موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی.
 *
 * قاعدهٔ طلایی قرارداد: «تأییدکننده ≠ ثبت‌کننده» — در هر مرحله اگر selfApproval=false باشد،
 * همان کاربری نمونه را آغاز کرده حق تأیید آن مرحله را ندارد (۴۰۳).
 *
 * امضای الکترونیکی: هر اقدام HMAC-SHA256(WORKFLOW_SIGN_SECRET، بدنهٔ اقدام) و هش زنجیره‌ای
 * (هر اقدام از هش اقدام قبلی) — تغییر هر رکورد زنجیره را می‌شکند و verify شکست را گزارش می‌کند.
 * تکمیل آخرین مرحله → رویداد workflow.completed در همان تراکنش (Transactional Outbox).
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { EVENT_NAMES } from '@hotel-erp/contracts';
import { PrismaService } from '../prisma.service';
import { OutboxService } from '../outbox/outbox.service';

export interface WorkflowStep {
  order: number;
  title: string;
  /** مجوز لازم برای تأیید این مرحله (مثلاً journal.approve) */
  permission: string;
  /** حداقل تعداد تأیید برای گذر از مرحله (پیش‌فرض ۱) */
  minApprovers?: number;
  /** خودتأییری ممنوع؟ پیش‌فرض true = ممنوع */
  selfApproval?: boolean;
}

const GENESIS = 'GENESIS';

@Injectable()
export class WorkflowService {
  private readonly signSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {
    // در استقرار واقعی الزاماً از env — مقدار پیش‌فرض فقط برای تست محلی
    this.signSecret = process.env.WORKFLOW_SIGN_SECRET ?? 'dev-only-workflow-secret-change-me';
  }

  /** تعریف/به‌روزرسانی گردش کار (نسخه‌دار) */
  async upsertDef(input: {
    code: string; title: string; steps: WorkflowStep[]; userId: string;
  }) {
    if (!input.steps.length) {
      throw new ConflictException({ code: 'CONFLICT', message: 'گردش کار بدون مرحله معنی ندارد' });
    }
    // مراحل باید پیوسته از ۱ شروع شوند
    const orders = input.steps.map((s) => s.order).sort((a, b) => a - b);
    orders.forEach((o, i) => {
      if (o !== i + 1) {
        throw new ConflictException({ code: 'CONFLICT', message: 'مرحله‌ها باید از ۱ پیوسته شماره‌گذاری شوند' });
      }
    });
    const existing = await this.prisma.workflowDef.findUnique({ where: { code: input.code } });
    const data = { title: input.title, steps: input.steps as never };
    const row = existing
      ? await this.prisma.workflowDef.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
      : await this.prisma.workflowDef.create({ data: { code: input.code, ...data } });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'WORKFLOW_DEF_UPSERTED', entity: 'WorkflowDef', entityId: row.id, reason: `v${row.version}` },
    });
    return { data: this.defDto(row) };
  }

  async listDefs() {
    const rows = await this.prisma.workflowDef.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    return { data: rows.map((r) => this.defDto(r)) };
  }

  /** شروع نمونهٔ گردش کار روی یک نهاد — Idempotent (همان نهاد → همان نمونه) */
  async start(input: {
    defCode: string; entityType: string; entityId: string; title: string; userId: string; userPerms: Set<string>;
  }) {
    if (!input.userPerms.has('workflow.act')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'شروع گردش کار نیازمند مجوز workflow.act است' });
    }
    const def = await this.prisma.workflowDef.findUnique({ where: { code: input.defCode } });
    if (!def || !def.active) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `تعریف گردش کار ${input.defCode} یافت نشد` });
    }
    const existing = await this.prisma.workflowInstance.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId },
    });
    if (existing) return this.detail(existing.id);

    const inst = await this.prisma.workflowInstance.create({
      data: {
        defId: def.id, entityType: input.entityType, entityId: input.entityId,
        title: input.title, status: 'IN_PROGRESS', currentStep: 1, initiatedById: input.userId,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: input.userId, action: 'WORKFLOW_STARTED', entity: 'WorkflowInstance', entityId: inst.id, reason: input.defCode },
    });
    return this.detail(inst.id);
  }

  async list(filters: { status?: string; entityType?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.entityType) where.entityType = filters.entityType;
    const rows = await this.prisma.workflowInstance.findMany({
      where: where as never, orderBy: { createdAt: 'desc' }, take: 500,
      include: { def: true, actions: { orderBy: { at: 'asc' } } },
    });
    return { data: rows.map((r) => this.instDto(r)), count: rows.length };
  }

  async detail(id: string) {
    const inst = await this.prisma.workflowInstance.findUnique({
      where: { id }, include: { def: true, actions: { orderBy: { at: 'asc' } } },
    });
    if (!inst) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نمونهٔ گردش کار یافت نشد' });
    return { data: this.instDto(inst) };
  }

  /** تأیید مرحلهٔ جاری — با مجوزِ مرحله و ممنوعیت خودتأییری */
  async approve(id: string, userId: string, userName: string, userPerms: Set<string>, comment: string) {
    if (!userPerms.has('workflow.act')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'تأیید نیازمند مجوز workflow.act است' });
    }
    const inst = await this.prisma.workflowInstance.findUnique({ where: { id }, include: { def: true } });
    if (!inst) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نمونهٔ گردش کار یافت نشد' });
    if (inst.status !== 'IN_PROGRESS') {
      throw new ConflictException({ code: 'CONFLICT', message: `نمونه در وضعیت ${inst.status} است — اقدام ممکن نیست` });
    }
    const steps = inst.def.steps as unknown as WorkflowStep[];
    const step = steps.find((s) => s.order === inst.currentStep);
    if (!step) throw new ConflictException({ code: 'CONFLICT', message: 'مرحلهٔ جاری یافت نشد' });

    if (!userPerms.has(step.permission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `این مرحله نیازمند مجوز ${step.permission} است` });
    }
    // selfApproval=true یعنی خودتأییری مجاز؛ پیش‌فرض (undefined/false) = ممنوع
    const noSelf = step.selfApproval !== true;
    if (noSelf && inst.initiatedById === userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'خودتأییری ممنوع است — تأییدکننده ≠ ثبت‌کننده' });
    }
    // یک کاربر در یک مرحله فقط یک بار تأیید می‌کند
    const already = await this.prisma.workflowAction.findFirst({
      where: { instanceId: id, stepNo: inst.currentStep, action: 'APPROVE', actorId: userId },
    });
    if (already) {
      throw new ConflictException({ code: 'CONFLICT', message: 'شما قبلاً این مرحله را تأیید کرده‌اید' });
    }

    const minApprovers = step.minApprovers ?? 1;
    const approvedCount = await this.prisma.workflowAction.count({
      where: { instanceId: id, stepNo: inst.currentStep, action: 'APPROVE' },
    });
    const willCompleteStep = approvedCount + 1 >= minApprovers;
    const isLastStep = inst.currentStep >= steps.length;
    const finished = willCompleteStep && isLastStep;

    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.workflowAction.findFirst({
        where: { instanceId: id }, orderBy: { at: 'desc' }, select: { hash: true },
      });
      const prevHash = prev?.hash ?? GENESIS;
      const at = new Date();
      const payloadHash = createHash('sha256').update(`${id}|${step.order}|APPROVE|${userId}|${at.toISOString()}`).digest('hex');
      const signature = createHmac('sha256', this.signSecret)
        .update(`${id}|${step.order}|APPROVE|${userId}|${at.toISOString()}|${payloadHash}`).digest('hex');
      const hash = createHash('sha256').update(`${prevHash}|${signature}|APPROVE|${userId}`).digest('hex');

      await tx.workflowAction.create({
        data: { instanceId: id, stepNo: step.order, action: 'APPROVE', actorId: userId, actorName: userName, comment, signature, prevHash, hash, at },
      });

      const res = await tx.workflowInstance.update({
        where: { id },
        data: willCompleteStep
          ? (isLastStep
            ? { status: 'APPROVED', finishedAt: at, currentStep: step.order }
            : { currentStep: step.order + 1 })
          : {},
      });

      if (finished) {
        // رویداد تکمیل در همان تراکنشِ اقدام آخر — اتمیک بودن عملیات و رویداد
        await this.outbox.enqueue(tx, {
          eventName: EVENT_NAMES.WORKFLOW_COMPLETED,
          aggregate: `workflow:${id}`,
          idempotencyKey: `wf-complete:${id}`,
          producer: 'workflow',
          payload: {
            instanceId: id, defCode: inst.def.code, entityType: inst.entityType,
            entityId: inst.entityId, title: inst.title,
          },
        });
      }
      return res;
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'WORKFLOW_STEP_APPROVED', entity: 'WorkflowInstance', entityId: id, reason: `step ${inst.currentStep}` },
    });
    return this.detail(id);
  }

  /** رد نمونه — دلیل اجباری؛ نمونه تمام می‌شود */
  async reject(id: string, userId: string, userName: string, userPerms: Set<string>, reason: string) {
    if (!userPerms.has('workflow.act')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'رد نیازمند مجوز workflow.act است' });
    }
    if (!reason || !reason.trim()) {
      throw new ConflictException({ code: 'CONFLICT', message: 'دلیل رد اجباری است' });
    }
    const inst = await this.prisma.workflowInstance.findUnique({ where: { id }, include: { def: true } });
    if (!inst) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نمونهٔ گردش کار یافت نشد' });
    if (inst.status !== 'IN_PROGRESS') {
      throw new ConflictException({ code: 'CONFLICT', message: `نمونه در وضعیت ${inst.status} است — اقدام ممکن نیست` });
    }
    const steps = inst.def.steps as unknown as WorkflowStep[];
    const step = steps.find((s) => s.order === inst.currentStep)!;
    if (!userPerms.has(step.permission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: `این مرحله نیازمند مجوز ${step.permission} است` });
    }

    await this.prisma.$transaction(async (tx) => {
      const prev = await tx.workflowAction.findFirst({
        where: { instanceId: id }, orderBy: { at: 'desc' }, select: { hash: true },
      });
      const prevHash = prev?.hash ?? GENESIS;
      const at = new Date();
      const payloadHash = createHash('sha256').update(`${id}|${step.order}|REJECT|${userId}|${at.toISOString()}`).digest('hex');
      const signature = createHmac('sha256', this.signSecret)
        .update(`${id}|${step.order}|REJECT|${userId}|${at.toISOString()}|${payloadHash}`).digest('hex');
      const hash = createHash('sha256').update(`${prevHash}|${signature}|REJECT|${userId}`).digest('hex');
      await tx.workflowAction.create({
        data: { instanceId: id, stepNo: step.order, action: 'REJECT', actorId: userId, actorName: userName, comment: reason, signature, prevHash, hash, at },
      });
      await tx.workflowInstance.update({ where: { id }, data: { status: 'REJECTED', finishedAt: at } });
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'WORKFLOW_REJECTED', entity: 'WorkflowInstance', entityId: id, reason },
    });
    return this.detail(id);
  }

  /** لغو توسط آغازگر تا وقتی در جریان است */
  async cancel(id: string, userId: string, userPerms: Set<string>) {
    const inst = await this.prisma.workflowInstance.findUnique({ where: { id } });
    if (!inst) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نمونهٔ گردش کار یافت نشد' });
    if (inst.status !== 'IN_PROGRESS') {
      throw new ConflictException({ code: 'CONFLICT', message: `نمونه در وضعیت ${inst.status} است` });
    }
    const isAdmin = userPerms.has('workflow.manage');
    if (inst.initiatedById !== userId && !isAdmin) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'تنها آغازگر یا مدیر سیستم می‌تواند لغو کند' });
    }
    const updated = await this.prisma.workflowInstance.update({
      where: { id }, data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'WORKFLOW_CANCELLED', entity: 'WorkflowInstance', entityId: id, reason: updated.title },
    });
    return this.detail(id);
  }

  /** راستی‌آزمایی زنجیرهٔ امضا — تغییر هر رکورد اینجا آشکار می‌شود */
  async verify(id: string) {
    const inst = await this.prisma.workflowInstance.findUnique({
      where: { id }, include: { actions: { orderBy: { at: 'asc' } } },
    });
    if (!inst) throw new NotFoundException({ code: 'NOT_FOUND', message: 'نمونهٔ گردش کار یافت نشد' });

    let prevHash = GENESIS;
    for (const a of inst.actions) {
      const expected = createHash('sha256').update(`${prevHash}|${a.signature}|${a.action}|${a.actorId ?? ''}`).digest('hex');
      const sigBody = `${id}|${a.stepNo}|${a.action}|${a.actorId ?? ''}|${a.at.toISOString()}`;
      const sigOk = (() => {
        // امضا روی payloadHash محاسبه شده — payloadHash قابل بازتولید است
        const payloadHash = createHash('sha256').update(sigBody).digest('hex');
        const expectedSig = createHmac('sha256', this.signSecret)
          .update(`${sigBody}|${payloadHash}`).digest('hex');
        return expectedSig === a.signature;
      })();
      if (expected !== a.hash || !sigOk) {
        return {
          data: {
            instanceId: id, valid: false, brokenAtActionId: a.id, brokenAtStep: a.stepNo,
            reason: !sigOk ? 'امضای الکترونیکی ناهمخوان' : 'هش زنجیره ناهمخوان (رکورد دست‌کاری شده)',
          },
        };
      }
      prevHash = a.hash;
    }
    return { data: { instanceId: id, valid: true, actionsChecked: inst.actions.length } };
  }

  private defDto(r: { id: string; code: string; title: string; steps: unknown; version: number; active: boolean }) {
    return { id: r.id, code: r.code, title: r.title, steps: r.steps, version: r.version, active: r.active };
  }

  private instDto(r: {
    id: string; entityType: string; entityId: string; title: string; status: string; currentStep: number;
    initiatedById: string | null; finishedAt: Date | null; createdAt: Date;
    def: { code: string; title: string; steps: unknown };
    actions: Array<{ id: string; stepNo: number; action: string; actorName: string; comment: string; signature: string; hash: string; at: Date }>;
  }) {
    return {
      id: r.id, entityType: r.entityType, entityId: r.entityId, title: r.title,
      status: r.status, currentStep: r.currentStep, initiatedById: r.initiatedById,
      finishedAt: r.finishedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
      def: { code: r.def.code, title: r.def.title, steps: r.def.steps },
      actions: r.actions.map((a) => ({
        id: a.id, stepNo: a.stepNo, action: a.action, actorName: a.actorName,
        comment: a.comment, signature: a.signature.slice(0, 16) + '…', hash: a.hash.slice(0, 12) + '…',
        at: a.at.toISOString(),
      })),
    };
  }
}
