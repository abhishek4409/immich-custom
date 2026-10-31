import { Injectable } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { BaseService } from 'src/services/base.service.js';

@Injectable()
export class AuthAdminService extends BaseService {
  async unlinkAll(_auth: AuthDto) {
    const sessionIds = await this.userOAuthIdentityRepository.removeAll();
    for (const sessionId of sessionIds) {
      await this.eventRepository.emit('SessionDelete', { sessionId });
    }
  }
}
