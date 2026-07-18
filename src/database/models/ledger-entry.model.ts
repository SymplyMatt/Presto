import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'ledger_entries',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    {
      name: 'UQ_ledger_reference_entry',
      unique: true,
      fields: ['wallet_id', 'reference_id', 'entry_type'],
    },
    { name: 'IDX_ledger_wallet_created', fields: ['wallet_id', 'created_at'] },
  ],
})
export class ledgerEntryModel extends Model<
  InferAttributes<ledgerEntryModel>,
  InferCreationAttributes<ledgerEntryModel>
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

  @Column({ type: DataType.STRING(40), allowNull: false, field: 'entry_type' })
  declare entryType: string;

  @Column({ type: DataType.STRING(6), allowNull: false })
  declare direction: 'credit' | 'debit';

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare amount: number;

  @Column({ type: DataType.BIGINT, allowNull: false, field: 'balance_after' })
  declare balanceAfter: number;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'reference_type' })
  declare referenceType: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'reference_id' })
  declare referenceId: string;

  @Column({ type: DataType.STRING(30), allowNull: true, field: 'payment_processor_name' })
  declare paymentProcessorName: CreationOptional<string | null>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;
}
