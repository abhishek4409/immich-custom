import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger } from 'src/decorators.js';
import { UserOAuthIdentityRole } from 'src/enum.js';
import { UserTable } from 'src/schema/tables/user.table.js';

@Table('user_oauth_identity')
@UpdatedAtTrigger('user_oauth_identity_updatedAt')
@Index({ name: 'user_oauth_identity_unique_sub', columns: ['sub'], unique: true, where: '"sub" IS NOT NULL' })
@Index({ name: 'user_oauth_identity_unique_invite', columns: ['email'], unique: true, where: '"sub" IS NULL' })
@Index({ name: 'user_oauth_identity_unique_owner', columns: ['userId'], unique: true, where: `"role" = 'owner'` })
export class UserOAuthIdentityTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @Column({ type: 'character varying' })
  role!: UserOAuthIdentityRole;

  // null until an invite is accepted
  @Column({ nullable: true })
  sub!: string | null;

  @Column()
  email!: string;

  @Column({ nullable: true })
  name!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  inviteExpiresAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastLoginAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
