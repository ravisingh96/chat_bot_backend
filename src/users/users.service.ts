import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { DatabaseService } from '../database/database.service';

export type Role = 'admin' | 'manager';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: number;
  created_at: string;
}

export const publicUser = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  active: !!u.active,
  createdAt: u.created_at ? u.created_at.replace(' ', 'T') + 'Z' : null,
});

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    if ((await this.db.count('SELECT COUNT(*) AS n FROM users')) > 0) return;

    let password = config.seedAdminPassword;
    if (!password || password === 'change-me-now') {
      if (config.isServerless) {
        this.logger.error('No admin exists and SEED_ADMIN_PASSWORD is not set. Set it in the project environment variables.');
        return;
      }
      password = randomBytes(9).toString('base64url');
      // Written to a local file instead of the log so it does not end up in shared output.
      const dir = join(process.cwd(), 'data');
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'FIRST_ADMIN_PASSWORD.txt'), `${config.seedAdminEmail}\n${password}\n`);
      this.logger.warn('Generated first admin password -> server/data/FIRST_ADMIN_PASSWORD.txt');
    }
    await this.db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      'Administrator',
      config.seedAdminEmail.toLowerCase(),
      bcrypt.hashSync(password, 10),
      'admin',
    );
    this.logger.log(`Seeded admin user ${config.seedAdminEmail}`);
  }

  findByEmail(email: string) {
    return this.db.get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
  }

  findById(id: number) {
    return this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
  }

  async list() {
    return (await this.db.all<UserRow>('SELECT * FROM users ORDER BY id')).map(publicUser);
  }

  async create(input: { name: string; email: string; password: string; role: Role }) {
    const email = input.email.trim().toLowerCase();
    if (await this.findByEmail(email)) throw new ConflictException('A user with this email already exists');
    const r = await this.db.run(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      input.name.trim(),
      email,
      bcrypt.hashSync(input.password, 10),
      input.role,
    );
    return publicUser((await this.findById(r.lastId))!);
  }

  async update(id: number, actorId: number, patch: { name?: string; role?: Role; active?: boolean; password?: string }) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const losesAdmin =
      user.role === 'admin' &&
      ((patch.role && patch.role !== 'admin') || patch.active === false);
    if (losesAdmin) {
      if (id === actorId) throw new BadRequestException('You cannot demote or deactivate your own account');
      const admins = await this.db.count("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1");
      if (admins <= 1) throw new BadRequestException('At least one active admin is required');
    }

    await this.db.run(
      'UPDATE users SET name = ?, role = ?, active = ?, password_hash = ? WHERE id = ?',
      patch.name?.trim() || user.name,
      patch.role ?? user.role,
      patch.active === undefined ? user.active : patch.active ? 1 : 0,
      patch.password ? bcrypt.hashSync(patch.password, 10) : user.password_hash,
      id,
    );
    return publicUser((await this.findById(id))!);
  }
}
