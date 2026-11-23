import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: { id: string; username: string; roles: string[]; fullName?: string; perms?: Set<string> };
}
