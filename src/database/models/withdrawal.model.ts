import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table, UpdatedAt } from 'sequelize-typescript';

@Table({
  tableName: 'withdrawals',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'UQ_withdrawal_idempotency',
      unique: true,
      fields: ['wallet_id', 'idempotency_key'],
    },
    {
      name: 'UQ_withdrawal_provider_reference',
      unique: true,
      fields: ['provider_name', 'provider_reference'],
    },
  ],
})
export class withdrawalModel extends Model<
  InferAttributes<withdrawalModel>,
  InferCreationAttributes<withdrawalModel>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'wallet_id',
    references: { model: 'wallets', key: 'id' },
  })
  declare walletId: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare amount: number;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'NGN' })
  declare currency: CreationOptional<string>;

  @Column({ type: DataType.STRING(20), allowNull: false, field: 'bank_code' })
  declare bankCode: string;

  @Column({ type: DataType.STRING(4), allowNull: false, field: 'account_number_last_four' })
  declare accountNumberLastFour: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'account_name' })
  declare accountName: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'recipient_code' })
  declare recipientCode: string;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'provider_name' })
  declare providerName: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'provider_reference' })
  declare providerReference: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'provider_transfer_code' })
  declare providerTransferCode: CreationOptional<string | null>;

  @Column({ type: DataType.STRING, allowNull: false, field: 'idempotency_key' })
  declare idempotencyKey: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'pending' })
  declare status: CreationOptional<string>;

  @Column({ type: DataType.STRING(160), allowNull: true })
  declare reason: CreationOptional<string | null>;

  @Column({ type: DataType.DATE, allowNull: true, field: 'completed_at' })
  declare completedAt: CreationOptional<Date | null>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;

  @UpdatedAt
  declare updatedAt: CreationOptional<Date>;
}
