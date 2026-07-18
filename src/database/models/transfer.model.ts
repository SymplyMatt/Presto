import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'transfers',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    {
      name: 'UQ_transfer_idempotency',
      unique: true,
      fields: ['sender_wallet_id', 'idempotency_key'],
    },
  ],
})
export class transferModel extends Model<
  InferAttributes<transferModel>,
  InferCreationAttributes<transferModel>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'sender_wallet_id',
    references: { model: 'wallets', key: 'id' },
  })
  declare senderWalletId: string;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'receiver_wallet_id',
    references: { model: 'wallets', key: 'id' },
  })
  declare receiverWalletId: string;

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare amount: number;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'NGN' })
  declare currency: CreationOptional<string>;

  @Column({ type: DataType.STRING, allowNull: false, field: 'idempotency_key' })
  declare idempotencyKey: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'completed' })
  declare status: CreationOptional<string>;

  @Column({ type: DataType.STRING(160), allowNull: true })
  declare description: CreationOptional<string | null>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;
}
