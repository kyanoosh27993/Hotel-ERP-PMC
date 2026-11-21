# HOTEL ERP – AI DEVELOPMENT MASTER RULES

> قرارداد توسعه با هوش مصنوعی — الزامی برای هر هوش مصنوعی که در تولید این نرم‌افزار استفاده می‌شود.
> این دستورالعمل در ریشه پروژه قرار دارد (طبق دستور مالک، جلسه ۲۱ نوامبر ۲۰۲۶) و مکمل
> [AI_DEVELOPMENT_RULES.md](AI_DEVELOPMENT_RULES.md) (قوانین ۲۰گانه مالک) است.
> در تعارض: قوانین مالک + این قرارداد هر دو الزامی‌اند؛ در مورد اختصاصی‌تر، سخت‌گیرانه‌ترین قاعده مقدم است.

---

## 1. Project Objective

Build a complete, modular, integrated, secure, bilingual hotel management ERP/PMS designed initially for the Iranian hospitality industry.

## 2. Core Technology

- Frontend: Next.js, React, TypeScript.
- Backend: NestJS, TypeScript.
- Database: PostgreSQL.
- Cache: Redis.
- Messaging: RabbitMQ.
- Android: Flutter.
- Infrastructure: Docker, CI/CD.
- API documentation: OpenAPI.

## 3. Architectural Rules

- Use Modular Monolith architecture.
- Maintain strict domain boundaries.
- Each module owns its business logic and data.
- Never bypass domain services to modify another module's data.
- Use versioned APIs.
- Use domain events for cross-module communication.
- Implement transactional outbox and idempotent consumers.
- Maintain a single source of truth for each business entity.

## 4. Financial Rules

- Use double-entry accounting.
- Every posted journal entry must balance.
- Never use floating-point numbers for monetary calculations.
- Posted financial documents must not be physically deleted.
- Corrections must use approved reversal or adjustment workflows.
- Every financial transaction must have a traceable source.
- Financial periods must support locking and controlled reopening.

## 5. Security Rules

- Enforce server-side authorization.
- Implement RBAC and ABAC.
- Use secure password hashing.
- Encrypt sensitive data.
- Use HTTPS.
- Maintain immutable audit records.
- Apply rate limiting and input validation.
- Never expose database credentials or secrets.
- Never store raw bank card credentials.
- Follow OWASP ASVS 5.0.

## 6. Localization

- English is the default application language.
- Persian is fully supported.
- Support RTL and LTR layouts.
- Support Gregorian and Persian calendars.
- Store dates in standard database formats.
- Support Rial as the primary accounting currency.
- Never mix display formatting with financial calculations.

## 7. AI Rules

- AI must never directly execute unauthorized financial transactions.
- AI-generated accounting documents must remain drafts until authorized approval.
- All AI answers must be traceable to authorized source data.
- Respect user permissions when retrieving information.
- Protect personal and confidential information.
- Validate all AI-generated structured data before execution.

## 8. Development Process

- Implement only one approved development task at a time.
- Read the relevant project specifications before coding.
- Do not invent undocumented business rules.
- If a requirement is incomplete, use an explicitly documented safe default or mark it as a blocking assumption.
- Write unit and integration tests for every business-critical feature.
- Run all relevant tests before committing.
- Never claim a feature is complete without passing its acceptance tests.
- Maintain migration scripts for every database change.
- Update API documentation and user documentation.

## 9. Completion Criteria

A module is complete only when:

- Its business requirements are implemented.
- Its database schema is documented.
- Its API is documented.
- Its authorization rules are implemented.
- Its tests pass.
- Its audit requirements are implemented.
- Its integration contracts are validated.
- Its acceptance criteria are met.

## 10. Primary Development Principle

Reliability, financial correctness, security, legal compliance, traceability, and maintainability always take priority over development speed.
