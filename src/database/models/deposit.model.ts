import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table, UpdatedAt } from 'sequelize-typescript';

@Table({
  tableName: 'deposits',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'UQ_deposit_provider_reference',
      unique: true,
      fields: ['provider_name', 'provider_reference'],
    },
    {
      name: 'UQ_deposit_idempotency',
      unique: true,
      fields: ['wallet_id', 'idempotency_key'],
    },
  ],
})
export class depositModel extends Model<
  InferAttributes<depositModel>,
  InferCreationAttributes<depositModel>
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

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'provider_name' })
  declare providerName: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'provider_reference' })
  declare providerReference: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'idempotency_key' })
  declare idempotencyKey: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'pending' })
  declare status: CreationOptional<string>;

  @Column({ type: DataType.STRING, allowNull: true, field: 'checkout_url' })
  declare checkoutUrl: CreationOptional<string | null>;

  @Column({ type: DataType.STRING, allowNull: true, field: 'access_code' })
  declare accessCode: CreationOptional<string | null>;

  @Column({ type: DataType.DATE, allowNull: true, field: 'confirmed_at' })
  declare confirmedAt: CreationOptional<Date | null>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;

  @UpdatedAt
  declare updatedAt: CreationOptional<Date>;
}
